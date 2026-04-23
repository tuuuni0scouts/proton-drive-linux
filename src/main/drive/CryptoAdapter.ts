/**
 * Implements the OpenPGPCrypto interface required by the Proton Drive SDK
 * using the openpgp.js v5 library.
 *
 * The interface is defined in:
 *   sdk/js/sdk/src/crypto/interface.ts
 *
 * All methods prefer binary (Uint8Array) I/O.  Armored variants handle
 * conversion to/from ASCII-armored PGP format.
 */
import * as openpgp from 'openpgp';
import { randomBytes } from 'crypto';
import type {
  OpenPGPCrypto,
  PrivateKey,
  PublicKey,
  SessionKey,
} from '@protontech/drive-sdk';
import { VERIFICATION_STATUS } from '@protontech/drive-sdk';

type OKey = openpgp.Key;
type OPrivateKey = openpgp.PrivateKey;
type OSessionKey = openpgp.SessionKey;

// Cast helpers – SDK key objects are openpgp keys at runtime
const asOpgpKey = (k: PublicKey | PrivateKey): OKey => k as unknown as OKey;
const asOpgpPrivate = (k: PrivateKey): OPrivateKey => k as unknown as OPrivateKey;
const asOpgpSession = (sk: SessionKey): OSessionKey =>
  ({ data: sk.data, algorithm: sk.algorithm ?? 'aes256' } as OSessionKey);
const fromOpgpSession = (sk: OSessionKey): SessionKey =>
  ({ data: sk.data, algorithm: sk.algorithm, aeadAlgorithm: null });

function toKeys<T extends PublicKey | PrivateKey>(k: T | T[]): OKey[] {
  return (Array.isArray(k) ? k : [k]).map(asOpgpKey);
}

export class CryptoAdapter implements OpenPGPCrypto {
  generatePassphrase(): string {
    return randomBytes(32).toString('base64');
  }

  async generateSessionKey(
    encryptionKeys: PublicKey[],
    options: { enableAeadWithEncryptionKeys: boolean },
  ): Promise<SessionKey> {
    const sk = await openpgp.generateSessionKey({
      encryptionKeys: toKeys(encryptionKeys) as openpgp.PublicKey[],
      config: options.enableAeadWithEncryptionKeys ? { aeadProtect: true } : {},
    });
    return fromOpgpSession(sk);
  }

  async encryptSessionKey(
    sessionKey: SessionKey,
    encryptionKeys: PublicKey | PublicKey[],
  ): Promise<{ keyPacket: Uint8Array<ArrayBuffer> }> {
    const msg = await openpgp.encryptSessionKey({
      ...asOpgpSession(sessionKey),
      encryptionKeys: toKeys(encryptionKeys) as openpgp.PublicKey[],
      format: 'binary',
    });
    return { keyPacket: msg as unknown as Uint8Array<ArrayBuffer> };
  }

  async encryptSessionKeyWithPassword(
    sessionKey: SessionKey,
    password: string,
  ): Promise<{ keyPacket: Uint8Array<ArrayBuffer> }> {
    const msg = await openpgp.encryptSessionKey({
      ...asOpgpSession(sessionKey),
      passwords: [password],
      format: 'binary',
    });
    return { keyPacket: msg as unknown as Uint8Array<ArrayBuffer> };
  }

  async generateKey(
    passphrase: string,
    options: { enableAead: boolean },
  ): Promise<{ privateKey: PrivateKey; armoredKey: string }> {
    const { privateKey, publicKey: _pk } = await openpgp.generateKey({
      type: 'ecc',
      curve: 'curve25519',
      userIDs: [{ name: 'Drive Key' }],
      passphrase,
      format: 'armored',
      config: options.enableAead ? { aeadProtect: true } : {},
    });
    const decrypted = await openpgp.decryptKey({
      privateKey: await openpgp.readPrivateKey({ armoredKey: privateKey }),
      passphrase,
    });
    return { privateKey: decrypted as unknown as PrivateKey, armoredKey: privateKey };
  }

  async encryptArmored(
    data: Uint8Array<ArrayBuffer>,
    encryptionKeys: PublicKey[],
    sessionKey: SessionKey | undefined,
    options: { enableAeadWithEncryptionKeys: boolean },
  ): Promise<{ armoredData: string }> {
    const message = await openpgp.createMessage({ binary: data });
    const armoredData = await openpgp.encrypt({
      message,
      encryptionKeys: toKeys(encryptionKeys) as openpgp.PublicKey[],
      sessionKey: sessionKey ? asOpgpSession(sessionKey) : undefined,
      format: 'armored',
      config: options.enableAeadWithEncryptionKeys ? { aeadProtect: true } : {},
    }) as string;
    return { armoredData };
  }

  async encryptAndSign(
    data: Uint8Array<ArrayBuffer>,
    sessionKey: SessionKey,
    encryptionKeys: PublicKey[],
    signingKey: PrivateKey,
    options: { enableAeadWithEncryptionKeys: boolean },
  ): Promise<{ encryptedData: Uint8Array<ArrayBuffer> }> {
    const message = await openpgp.createMessage({ binary: data });
    const encryptedData = await openpgp.encrypt({
      message,
      encryptionKeys: toKeys(encryptionKeys) as openpgp.PublicKey[],
      signingKeys: [asOpgpPrivate(signingKey)],
      sessionKey: asOpgpSession(sessionKey),
      format: 'binary',
      config: options.enableAeadWithEncryptionKeys ? { aeadProtect: true } : {},
    }) as Uint8Array;
    return { encryptedData: encryptedData as Uint8Array<ArrayBuffer> };
  }

  async encryptAndSignArmored(
    data: Uint8Array<ArrayBuffer>,
    sessionKey: SessionKey | undefined,
    encryptionKeys: PublicKey[],
    signingKey: PrivateKey,
    options: { compress?: boolean; enableAeadWithEncryptionKeys: boolean },
  ): Promise<{ armoredData: string }> {
    const message = await openpgp.createMessage({ binary: data });
    const armoredData = await openpgp.encrypt({
      message,
      encryptionKeys: toKeys(encryptionKeys) as openpgp.PublicKey[],
      signingKeys: [asOpgpPrivate(signingKey)],
      sessionKey: sessionKey ? asOpgpSession(sessionKey) : undefined,
      format: 'armored',
      config: options.enableAeadWithEncryptionKeys ? { aeadProtect: true } : {},
    }) as string;
    return { armoredData };
  }

  async encryptAndSignDetached(
    data: Uint8Array<ArrayBuffer>,
    sessionKey: SessionKey,
    encryptionKeys: PublicKey[],
    signingKey: PrivateKey,
    options: { enableAeadWithEncryptionKeys: boolean },
  ): Promise<{ encryptedData: Uint8Array<ArrayBuffer>; signature: Uint8Array<ArrayBuffer> }> {
    const message = await openpgp.createMessage({ binary: data });
    const sigMessage = await openpgp.sign({ message, signingKeys: [asOpgpPrivate(signingKey)], detached: true, format: 'binary' });
    const encryptedData = await openpgp.encrypt({
      message,
      encryptionKeys: toKeys(encryptionKeys) as openpgp.PublicKey[],
      sessionKey: asOpgpSession(sessionKey),
      format: 'binary',
      config: options.enableAeadWithEncryptionKeys ? { aeadProtect: true } : {},
    }) as Uint8Array;
    return {
      encryptedData: encryptedData as Uint8Array<ArrayBuffer>,
      signature: sigMessage as unknown as Uint8Array<ArrayBuffer>,
    };
  }

  async encryptAndSignDetachedArmored(
    data: Uint8Array<ArrayBuffer>,
    sessionKey: SessionKey,
    encryptionKeys: PublicKey[],
    signingKey: PrivateKey,
    options: { enableAeadWithEncryptionKeys: boolean },
  ): Promise<{ armoredData: string; armoredSignature: string }> {
    const message = await openpgp.createMessage({ binary: data });
    const armoredSignature = await openpgp.sign({ message, signingKeys: [asOpgpPrivate(signingKey)], detached: true, format: 'armored' }) as string;
    const armoredData = await openpgp.encrypt({
      message,
      encryptionKeys: toKeys(encryptionKeys) as openpgp.PublicKey[],
      sessionKey: asOpgpSession(sessionKey),
      format: 'armored',
      config: options.enableAeadWithEncryptionKeys ? { aeadProtect: true } : {},
    }) as string;
    return { armoredData, armoredSignature };
  }

  async sign(
    data: Uint8Array<ArrayBuffer>,
    signingKey: PrivateKey,
    _signatureContext: string,
  ): Promise<{ signature: Uint8Array<ArrayBuffer> }> {
    const message = await openpgp.createMessage({ binary: data });
    const signature = await openpgp.sign({ message, signingKeys: [asOpgpPrivate(signingKey)], detached: true, format: 'binary' }) as Uint8Array;
    return { signature: signature as Uint8Array<ArrayBuffer> };
  }

  async signArmored(
    data: Uint8Array<ArrayBuffer>,
    signingKey: PrivateKey | PrivateKey[],
  ): Promise<{ signature: string }> {
    const message = await openpgp.createMessage({ binary: data });
    const keys = (Array.isArray(signingKey) ? signingKey : [signingKey]).map(asOpgpPrivate);
    const signature = await openpgp.sign({ message, signingKeys: keys, detached: true, format: 'armored' }) as string;
    return { signature };
  }

  async verify(
    data: Uint8Array<ArrayBuffer>,
    signature: Uint8Array<ArrayBuffer>,
    verificationKeys: PublicKey | PublicKey[],
  ): Promise<{ verified: VERIFICATION_STATUS; verificationErrors?: Error[] }> {
    const message = await openpgp.createMessage({ binary: data });
    const sig = await openpgp.readSignature({ binarySignature: signature });
    const result = await openpgp.verify({ message, signature: sig, verificationKeys: toKeys(verificationKeys) as openpgp.PublicKey[] });
    return this.mapVerifyResult(result.signatures);
  }

  async verifyArmored(
    data: Uint8Array<ArrayBuffer>,
    armoredSignature: string,
    verificationKeys: PublicKey | PublicKey[],
    _signatureContext?: string,
  ): Promise<{ verified: VERIFICATION_STATUS; verificationErrors?: Error[] }> {
    const message = await openpgp.createMessage({ binary: data });
    const sig = await openpgp.readSignature({ armoredSignature });
    const result = await openpgp.verify({ message, signature: sig, verificationKeys: toKeys(verificationKeys) as openpgp.PublicKey[] });
    return this.mapVerifyResult(result.signatures);
  }

  async decryptSessionKey(
    data: Uint8Array<ArrayBuffer>,
    decryptionKeys: PrivateKey | PrivateKey[],
  ): Promise<SessionKey> {
    const msg = await openpgp.readMessage({ binaryMessage: data });
    const sk = await openpgp.decryptSessionKeys({ message: msg, decryptionKeys: toKeys(decryptionKeys) as openpgp.PrivateKey[] });
    if (!sk[0]) throw new Error('Failed to decrypt session key');
    return fromOpgpSession(sk[0]);
  }

  async decryptArmoredSessionKey(
    armoredData: string,
    decryptionKeys: PrivateKey | PrivateKey[],
  ): Promise<SessionKey> {
    const msg = await openpgp.readMessage({ armoredMessage: armoredData });
    const sk = await openpgp.decryptSessionKeys({ message: msg, decryptionKeys: toKeys(decryptionKeys) as openpgp.PrivateKey[] });
    if (!sk[0]) throw new Error('Failed to decrypt armored session key');
    return fromOpgpSession(sk[0]);
  }

  async decryptKey(armoredKey: string, passphrase: string): Promise<PrivateKey> {
    const privateKey = await openpgp.readPrivateKey({ armoredKey });
    const decrypted = await openpgp.decryptKey({ privateKey, passphrase });
    return decrypted as unknown as PrivateKey;
  }

  async decryptAndVerify(
    data: Uint8Array<ArrayBuffer>,
    sessionKey: SessionKey,
    verificationKeys: PublicKey | PublicKey[],
  ): Promise<{ data: Uint8Array<ArrayBuffer>; verified: VERIFICATION_STATUS; verificationErrors?: Error[] }> {
    const message = await openpgp.readMessage({ binaryMessage: data });
    const result = await openpgp.decrypt({ message, sessionKeys: [asOpgpSession(sessionKey)], verificationKeys: toKeys(verificationKeys) as openpgp.PublicKey[], format: 'binary' });
    const verify = await this.mapVerifyResult(result.signatures);
    return { data: result.data as Uint8Array<ArrayBuffer>, ...verify };
  }

  async decryptAndVerifyDetached(
    data: Uint8Array<ArrayBuffer>,
    signature: Uint8Array<ArrayBuffer> | undefined,
    sessionKey: SessionKey,
    verificationKeys?: PublicKey | PublicKey[],
  ): Promise<{ data: Uint8Array<ArrayBuffer>; verified: VERIFICATION_STATUS; verificationErrors?: Error[] }> {
    const message = await openpgp.readMessage({ binaryMessage: data });
    const opts: Parameters<typeof openpgp.decrypt>[0] = {
      message,
      sessionKeys: [asOpgpSession(sessionKey)],
      format: 'binary',
    };
    if (verificationKeys) opts.verificationKeys = toKeys(verificationKeys) as openpgp.PublicKey[];
    if (signature) opts.signature = await openpgp.readSignature({ binarySignature: signature });
    const result = await openpgp.decrypt(opts);
    const verify = await this.mapVerifyResult(result.signatures);
    return { data: result.data as Uint8Array<ArrayBuffer>, ...verify };
  }

  async decryptArmored(armoredData: string, decryptionKeys: PrivateKey | PrivateKey[]): Promise<Uint8Array<ArrayBuffer>> {
    const message = await openpgp.readMessage({ armoredMessage: armoredData });
    const result = await openpgp.decrypt({ message, decryptionKeys: toKeys(decryptionKeys) as openpgp.PrivateKey[], format: 'binary' });
    return result.data as Uint8Array<ArrayBuffer>;
  }

  async decryptArmoredAndVerify(
    armoredData: string,
    decryptionKeys: PrivateKey | PrivateKey[],
    verificationKeys: PublicKey | PublicKey[],
  ): Promise<{ data: Uint8Array<ArrayBuffer>; verified: VERIFICATION_STATUS; verificationErrors?: Error[] }> {
    const message = await openpgp.readMessage({ armoredMessage: armoredData });
    const result = await openpgp.decrypt({ message, decryptionKeys: toKeys(decryptionKeys) as openpgp.PrivateKey[], verificationKeys: toKeys(verificationKeys) as openpgp.PublicKey[], format: 'binary' });
    const verify = await this.mapVerifyResult(result.signatures);
    return { data: result.data as Uint8Array<ArrayBuffer>, ...verify };
  }

  async decryptArmoredAndVerifyDetached(
    armoredData: string,
    armoredSignature: string | undefined,
    sessionKey: SessionKey,
    verificationKeys: PublicKey | PublicKey[],
  ): Promise<{ data: Uint8Array<ArrayBuffer>; verified: VERIFICATION_STATUS; verificationErrors?: Error[] }> {
    const message = await openpgp.readMessage({ armoredMessage: armoredData });
    const opts: Parameters<typeof openpgp.decrypt>[0] = {
      message,
      sessionKeys: [asOpgpSession(sessionKey)],
      verificationKeys: toKeys(verificationKeys) as openpgp.PublicKey[],
      format: 'binary',
    };
    if (armoredSignature) opts.signature = await openpgp.readSignature({ armoredSignature });
    const result = await openpgp.decrypt(opts);
    const verify = await this.mapVerifyResult(result.signatures);
    return { data: result.data as Uint8Array<ArrayBuffer>, ...verify };
  }

  async decryptArmoredWithPassword(armoredData: string, password: string): Promise<Uint8Array<ArrayBuffer>> {
    const message = await openpgp.readMessage({ armoredMessage: armoredData });
    const result = await openpgp.decrypt({ message, passwords: [password], format: 'binary' });
    return result.data as Uint8Array<ArrayBuffer>;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async mapVerifyResult(
    sigs: openpgp.VerificationResult[],
  ): Promise<{ verified: VERIFICATION_STATUS; verificationErrors?: Error[] }> {
    if (sigs.length === 0) return { verified: VERIFICATION_STATUS.NOT_SIGNED };
    const errors: Error[] = [];
    for (const sig of sigs) {
      try {
        await sig.verified;
      } catch (e) {
        errors.push(e as Error);
      }
    }
    if (errors.length === 0) return { verified: VERIFICATION_STATUS.SIGNED_AND_VALID };
    return { verified: VERIFICATION_STATUS.SIGNED_AND_INVALID, verificationErrors: errors };
  }
}
