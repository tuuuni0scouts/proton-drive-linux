/**
 * Implements the ProtonDriveAccount interface required by the SDK.
 *
 * Provides the SDK with access to the user's address keys, which are
 * needed for node encryption/decryption.
 */
import * as openpgp from 'openpgp';
import { protonRequest } from '../auth/ProtonHttpClient';
import type { AuthManager } from '../auth/AuthManager';
import type { ProtonDriveAccount, ProtonDriveAccountAddress, PrivateKey, PublicKey } from '@protontech/drive-sdk';

interface ApiAddressKey { ID: string; PrivateKey: string; Primary: number; }
interface ApiAddress { ID: string; Email: string; Keys: ApiAddressKey[]; }

export class AccountAdapter implements ProtonDriveAccount {
  private addressCache: ProtonDriveAccountAddress[] | null = null;
  private publicKeyCache = new Map<string, PublicKey[]>();

  constructor(private readonly auth: AuthManager) {}

  invalidateCache(): void {
    this.addressCache = null;
    this.publicKeyCache.clear();
  }

  async getOwnPrimaryAddress(): Promise<ProtonDriveAccountAddress> {
    const addresses = await this.getOwnAddresses();
    const primary = addresses[0];
    if (!primary) throw new Error('No primary address available');
    return primary;
  }

  async getOwnAddresses(): Promise<ProtonDriveAccountAddress[]> {
    if (this.addressCache) return this.addressCache;

    const session = this.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const res = await protonRequest<{ Code: number; Addresses: ApiAddress[] }>(
      { path: '/core/v4/addresses' },
      session,
    );

    this.addressCache = await Promise.all(
      res.Addresses.map(async (addr) => this.buildAddress(addr, session.userKeyPassphrase)),
    );
    return this.addressCache;
  }

  async getOwnAddress(emailOrAddressId: string): Promise<ProtonDriveAccountAddress> {
    const addresses = await this.getOwnAddresses();
    const found = addresses.find(
      (a) => a.email === emailOrAddressId || a.addressId === emailOrAddressId,
    );
    if (!found) throw new Error(`Address not found: ${emailOrAddressId}`);
    return found;
  }

  async hasProtonAccount(email: string): Promise<boolean> {
    const session = this.auth.getSession();
    if (!session) return false;
    try {
      const res = await protonRequest<{ Code: number; Exists: number }>(
        { method: 'GET', path: `/core/v4/keys?Email=${encodeURIComponent(email)}` },
        session,
      );
      return res.Code === 1000;
    } catch {
      return false;
    }
  }

  async getPublicKeys(email: string, forceRefresh?: boolean): Promise<PublicKey[]> {
    if (!forceRefresh && this.publicKeyCache.has(email)) {
      return this.publicKeyCache.get(email)!;
    }
    const session = this.auth.getSession();
    if (!session) return [];
    try {
      const res = await protonRequest<{ Code: number; RecipientType: number; Keys: Array<{ PublicKey: string }> }>(
        { path: `/core/v4/keys?Email=${encodeURIComponent(email)}` },
        session,
      );
      const keys = await Promise.all(
        res.Keys.map((k) => openpgp.readKey({ armoredKey: k.PublicKey })),
      );
      const result = keys as unknown as PublicKey[];
      this.publicKeyCache.set(email, result);
      return result;
    } catch {
      return [];
    }
  }

  private async buildAddress(
    addr: ApiAddress,
    passphrase: string,
  ): Promise<ProtonDriveAccountAddress> {
    const keys = await Promise.all(
      addr.Keys.map(async (k) => {
        const privateKey = await openpgp.decryptKey({
          privateKey: await openpgp.readPrivateKey({ armoredKey: k.PrivateKey }),
          passphrase,
        });
        return { id: k.ID, key: privateKey as unknown as PrivateKey };
      }),
    );

    const primaryIndex = addr.Keys.findIndex((k) => k.Primary === 1);
    return {
      email: addr.Email,
      addressId: addr.ID,
      primaryKeyIndex: primaryIndex >= 0 ? primaryIndex : 0,
      keys,
    };
  }
}
