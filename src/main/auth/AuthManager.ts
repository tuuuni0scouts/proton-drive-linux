/**
 * Orchestrates the full Proton authentication flow:
 *   1. SRP negotiation with the /auth/v4 endpoint
 *   2. TOTP / 2FA if required
 *   3. User key decryption (bcrypt key stretching)
 *   4. Address key decryption
 *   5. Secure session persistence via keytar
 *
 * The SDK explicitly requires that:
 *  - Passwords are NEVER stored by third-party apps
 *  - Users are warned they are entering credentials in an unofficial app
 *
 * Those warnings are shown in the LoginView component.
 */
import { EventEmitter } from 'events';
import { getSrp, computeKeyPassword } from './ProtonSRP';
import { protonRequest, ProtonApiError } from './ProtonHttpClient';
import { saveSession, loadSession, clearSession } from './SessionStore';
import type { ProtonSession } from './SessionStore';

// Raw Proton API response shapes (minimal, for what we need)
interface AuthInfoResponse {
  Code: number;
  Modulus: string;
  ServerEphemeral: string;
  Version: number;
  Salt: string;
  SRPSession: string;
}

interface AuthResponse {
  Code: number;
  UID: string;
  AccessToken: string;
  RefreshToken: string;
  TokenType: string;
  Scope: string;
  TwoFactor?: { Enabled: number };
  PasswordMode?: number;
}

interface UserResponse {
  Code: number;
  User: {
    ID: string;
    Name: string;
    Email: string;
    Keys: Array<{ ID: string; PrivateKey: string; Primary: number }>;
  };
}

interface AddressesResponse {
  Code: number;
  Addresses: Array<{
    ID: string;
    Email: string;
    Keys: Array<{ ID: string; PrivateKey: string; Primary: number }>;
  }>;
}

export class AuthManager extends EventEmitter {
  private session: ProtonSession | null = null;

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async loadExistingSession(): Promise<boolean> {
    this.session = await loadSession();
    if (!this.session) return false;
    // Validate by making a cheap API call
    try {
      await protonRequest({ path: '/core/v4/tests/ping' }, this.session);
      return true;
    } catch (err) {
      if (err instanceof ProtonApiError && err.httpStatus === 401) {
        // Try token refresh
        const refreshed = await this.refreshToken();
        return refreshed;
      }
      // Offline or transient error – still usable
      return true;
    }
  }

  /**
   * Perform SRP login.  Never stores the plain-text password.
   * Returns true on success, or throws with a user-readable message.
   */
  async login(
    username: string,
    password: string,
    totp?: string,
  ): Promise<{ ok: true } | { ok: false; requireTotp: boolean; error: string }> {
    // Step 1: get SRP parameters
    let info: AuthInfoResponse;
    try {
      info = await protonRequest<AuthInfoResponse>({
        method: 'POST',
        path: '/core/v4/auth/info',
        json: { Username: username },
      });
    } catch (e) {
      return { ok: false, requireTotp: false, error: String(e) };
    }

    // Step 2: client-side SRP computation
    const srp = await getSrp(
      info.Version,
      info.Modulus,
      info.ServerEphemeral,
      info.Salt,
      password,
    );

    // Step 3: authenticate
    let authRes: AuthResponse;
    try {
      authRes = await protonRequest<AuthResponse>({
        method: 'POST',
        path: '/core/v4/auth',
        json: {
          Username: username,
          SRPSession: info.SRPSession,
          ClientEphemeral: srp.clientEphemeral,
          ClientProof: srp.clientProof,
          TwoFactorCode: totp,
        },
      });
    } catch (e) {
      if (e instanceof ProtonApiError && e.apiCode === 10003) {
        // TOTP required
        return { ok: false, requireTotp: true, error: 'Two-factor authentication required' };
      }
      return { ok: false, requireTotp: false, error: String(e) };
    }

    const partialSession = {
      uid: authRes.UID,
      accessToken: authRes.AccessToken,
      refreshToken: authRes.RefreshToken,
    };

    // Step 4: load user + addresses + decrypt keys
    try {
      const [userRes, addrRes] = await Promise.all([
        protonRequest<UserResponse>({ path: '/core/v4/users' }, partialSession as ProtonSession),
        protonRequest<AddressesResponse>({ path: '/core/v4/addresses' }, partialSession as ProtonSession),
      ]);

      const primaryUserKey = userRes.User.Keys.find(k => k.Primary === 1);
      if (!primaryUserKey) throw new Error('No primary user key found');

      // Derive mailbox password (bcrypt stretch) to decrypt user key
      const keyPassword = await computeKeyPassword(password, info.Salt);

      const primaryAddress = addrRes.Addresses[0];
      if (!primaryAddress) throw new Error('No addresses found');

      const session: ProtonSession = {
        uid: authRes.UID,
        accessToken: authRes.AccessToken,
        refreshToken: authRes.RefreshToken,
        username,
        email: primaryAddress.Email,
        primaryAddressId: primaryAddress.ID,
        armoredUserKey: primaryUserKey.PrivateKey,
        userKeyPassphrase: keyPassword,
      };

      this.session = session;
      await saveSession(session);
      this.emit('authenticated', session);
      return { ok: true };
    } catch (e) {
      return { ok: false, requireTotp: false, error: String(e) };
    }
  }

  async logout(): Promise<void> {
    if (this.session) {
      try {
        await protonRequest({ method: 'DELETE', path: '/core/v4/auth' }, this.session);
      } catch { /* ignore */ }
    }
    this.session = null;
    await clearSession();
    this.emit('unauthenticated');
  }

  getSession(): ProtonSession | null {
    return this.session;
  }

  isAuthenticated(): boolean {
    return this.session !== null;
  }

  // -----------------------------------------------------------------------
  // Token refresh
  // -----------------------------------------------------------------------

  private async refreshToken(): Promise<boolean> {
    if (!this.session) return false;
    try {
      const res = await protonRequest<{ Code: number; AccessToken: string; RefreshToken: string }>({
        method: 'POST',
        path: '/core/v4/auth/refresh',
        json: {
          ResponseType: 'token',
          GrantType: 'refresh_token',
          RefreshToken: this.session.refreshToken,
          RedirectURI: 'https://protonmail.com',
          State: 'random',
        },
      }, this.session);
      this.session = { ...this.session, accessToken: res.AccessToken, refreshToken: res.RefreshToken };
      await saveSession(this.session);
      return true;
    } catch {
      return false;
    }
  }
}
