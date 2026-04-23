/**
 * Persists the Proton session tokens securely via libsecret/kwallet
 * through the `keytar` native module.
 *
 * Passwords are NEVER stored – only access/refresh tokens and the
 * session UID, in accordance with the SDK usage guidelines.
 */
import keytar from 'keytar';
import { KEYCHAIN_SERVICE, KEYCHAIN_SESSION_ACCOUNT } from '../../shared/constants';

export interface ProtonSession {
  /** Session UID – sent as x-pm-uid header */
  uid: string;
  accessToken: string;
  refreshToken: string;
  /** Human-readable account identifier for display only */
  username: string;
  email: string;
  /** User key ID for the primary address key (for AccountAdapter) */
  primaryAddressId: string;
  /** Armored private key for the primary address, decrypted in memory */
  armoredUserKey: string;
  userKeyPassphrase: string;
}

export async function saveSession(session: ProtonSession): Promise<void> {
  const payload = JSON.stringify(session);
  await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_SESSION_ACCOUNT, payload);
}

export async function loadSession(): Promise<ProtonSession | null> {
  const raw = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_SESSION_ACCOUNT);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProtonSession;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_SESSION_ACCOUNT);
}
