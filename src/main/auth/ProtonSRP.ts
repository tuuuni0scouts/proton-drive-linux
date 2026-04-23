/**
 * Proton SRP v3/v4 implementation.
 *
 * Proton uses a modified SRP-6a protocol where the password is stretched
 * with bcrypt before entering the SRP math.  The exact algorithm is
 * documented in Proton's security white-paper and their open-source web
 * client (@proton/srp).  This implementation follows the same steps.
 *
 * References:
 *  - https://proton.me/blog/encrypted-email-authentication
 *  - https://github.com/ProtonMail/WebClients (packages/srp)
 */
import bcrypt from 'bcryptjs';
import { sha512 } from '@noble/hashes/sha512';
import type { SRPModule, SRPVerifier } from '@protontech/drive-sdk';

// -------------------------------------------------------------------
// Big-integer helpers
// -------------------------------------------------------------------

function bytesToBigInt(buf: Uint8Array): bigint {
  let hex = '';
  for (const b of buf) hex += b.toString(16).padStart(2, '0');
  return BigInt('0x' + hex);
}

function bigIntToBytes(n: bigint, len: number): Uint8Array {
  const hex = n.toString(16).padStart(len * 2, '0');
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

// -------------------------------------------------------------------
// SRP constants (2048-bit MODP group, RFC 3526)
// -------------------------------------------------------------------

const N_HEX =
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
  '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
  'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D' +
  'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D' +
  '670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
  'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9' +
  'DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
  '15728E5A8AACAA68FFFFFFFFFFFFFFFF';

const N = BigInt('0x' + N_HEX);
const G = 2n;
const BYTE_LEN = 256; // 2048 / 8

function srp512(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const buf = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { buf.set(p, off); off += p.length; }
  return sha512(buf);
}

// -------------------------------------------------------------------
// Password hashing (Proton version v3/v4 = bcrypt)
// -------------------------------------------------------------------

// Proton's bcrypt salt encoding maps raw bytes to bcrypt's alphabet.
const BCRYPT_CHARS = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function encodeBcryptSalt(raw: Uint8Array): string {
  // Encodes up to 16 bytes (128 bits) as 22 bcrypt-alphabet characters
  let s = '';
  for (let i = 0; i < 12; i += 3) {
    const b0 = raw[i] ?? 0;
    const b1 = raw[i + 1] ?? 0;
    const b2 = raw[i + 2] ?? 0;
    s += BCRYPT_CHARS[b0 >> 2];
    s += BCRYPT_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    s += BCRYPT_CHARS[((b1 & 0xf) << 2) | (b2 >> 6)];
    s += BCRYPT_CHARS[b2 & 0x3f];
  }
  // Append the 4 bits from byte 12
  const b = raw[12] ?? 0;
  s += BCRYPT_CHARS[b >> 2];
  s += BCRYPT_CHARS[(b & 3) << 4];
  return s.slice(0, 22);
}

/**
 * Stretch a password into a key using bcrypt (Proton v3/v4).
 * The server-supplied salt (base64) provides the bcrypt salt.
 */
export async function computeKeyPassword(password: string, salt: string): Promise<string> {
  const saltBytes = Buffer.from(salt, 'base64');
  const bcryptSalt = '$2y$10$' + encodeBcryptSalt(new Uint8Array(saltBytes.buffer, saltBytes.byteOffset, saltBytes.byteLength));
  const hash = await bcrypt.hash(password.trim(), bcryptSalt);
  // Return the last 31 characters of the bcrypt output (the actual hash portion)
  return hash;
}

// -------------------------------------------------------------------
// SRP computation
// -------------------------------------------------------------------

/**
 * Perform the client side of Proton's SRP-6a exchange.
 *
 * @param version   - SRP version from server (3 or 4 uses bcrypt)
 * @param modulus   - PGP-armored modulus string from server
 * @param serverB64 - Server ephemeral B, base64-encoded
 * @param salt      - Password salt from server, base64-encoded
 * @param password  - Plain-text user password
 */
export async function getSrp(
  version: number,
  modulus: string,
  serverB64: string,
  salt: string,
  password: string,
): Promise<{ expectedServerProof: string; clientProof: string; clientEphemeral: string }> {
  // Derive password key
  const pwKey: Uint8Array =
    version >= 3
      ? await bcryptPasswordBytes(password, salt)
      : sha512(new TextEncoder().encode(password.trim()));

  const Nbytes = bigIntToBytes(N, BYTE_LEN);
  const gBytes = bigIntToBytes(G, BYTE_LEN);

  // k = H512(N | g)
  const k = bytesToBigInt(srp512(Nbytes, gBytes));

  // x = H512(salt | pwKey)
  const saltBytes = new Uint8Array(Buffer.from(salt, 'base64'));
  const x = bytesToBigInt(srp512(saltBytes, pwKey));

  // Random client secret a, compute A = g^a mod N
  const aBytes = crypto.getRandomValues(new Uint8Array(32));
  const a = bytesToBigInt(aBytes);
  const A = modPow(G, a, N);
  const Abytes = bigIntToBytes(A, BYTE_LEN);

  // Server public B
  const BrawBytes = new Uint8Array(Buffer.from(serverB64, 'base64'));
  const B = bytesToBigInt(BrawBytes);

  // u = H512(A | B)
  const u = bytesToBigInt(srp512(Abytes, BrawBytes));

  // S = (B - k*g^x)^(a + u*x) mod N
  const gx = modPow(G, x, N);
  const kgx = (k * gx) % N;
  const base = (B - kgx % N + N) % N;
  const exp = a + u * x;
  const S = modPow(base, exp, N);
  const Sbytes = bigIntToBytes(S, BYTE_LEN);

  // Client proof:  M1 = H512(A | B | S)
  const M1 = srp512(Abytes, BrawBytes, Sbytes);
  // Expected server proof: M2 = H512(A | M1 | S)
  const M2 = srp512(Abytes, M1, Sbytes);

  return {
    clientEphemeral: Buffer.from(Abytes).toString('base64'),
    clientProof: Buffer.from(M1).toString('base64'),
    expectedServerProof: Buffer.from(M2).toString('base64'),
  };
}

async function bcryptPasswordBytes(password: string, salt: string): Promise<Uint8Array> {
  const saltBytes = Buffer.from(salt, 'base64');
  const bcryptSalt = '$2y$10$' + encodeBcryptSalt(
    new Uint8Array(saltBytes.buffer, saltBytes.byteOffset, saltBytes.byteLength),
  );
  const hashStr = await bcrypt.hash(password.trim(), bcryptSalt);
  // Convert the bcrypt hash string to raw bytes for use in SRP
  return new TextEncoder().encode(hashStr);
}

/**
 * Generate an SRP verifier for a new password (used during password changes).
 */
export async function getSrpVerifier(password: string): Promise<SRPVerifier> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(10));
  const salt = Buffer.from(saltBytes).toString('base64');
  const pwKey = await bcryptPasswordBytes(password, salt);
  const x = bytesToBigInt(srp512(saltBytes, pwKey));
  const verifier = modPow(G, x, N);
  return {
    modulusId: '', // filled by server on actual registration
    version: 4,
    salt,
    verifier: Buffer.from(bigIntToBytes(verifier, BYTE_LEN)).toString('base64'),
  };
}

/** SRPModule implementation passed into the ProtonDriveClient. */
export const srpModule: SRPModule = {
  getSrp,
  getSrpVerifier,
  computeKeyPassword,
};
