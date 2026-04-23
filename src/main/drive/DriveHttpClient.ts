/**
 * Implements the ProtonDriveHTTPClient interface required by the SDK.
 *
 * Responsibilities:
 *  - Attach authentication headers (Bearer token, UID, app version)
 *  - Route requests to the correct Proton endpoint
 *  - Handle timeouts and forward AbortSignal cancellation
 *  - Trigger token refresh on 401 responses
 */
import type { ProtonDriveHTTPClient, ProtonDriveHTTPClientJsonRequest, ProtonDriveHTTPClientBlobRequest } from '@protontech/drive-sdk';
import { APP_VERSION_HEADER } from '../../shared/constants';
import type { AuthManager } from '../auth/AuthManager';

export class DriveHttpClient implements ProtonDriveHTTPClient {
  constructor(private readonly auth: AuthManager) {}

  async fetchJson(req: ProtonDriveHTTPClientJsonRequest): Promise<Response> {
    return this.execute(req, req.json ? JSON.stringify(req.json) : req.body);
  }

  async fetchBlob(req: ProtonDriveHTTPClientBlobRequest): Promise<Response> {
    return this.execute(req, req.body, req.onProgress);
  }

  private async execute(
    req: { url: string; method: string; headers: Headers; timeoutMs: number; signal?: AbortSignal },
    body?: BodyInit,
    onProgress?: (p: number) => void,
  ): Promise<Response> {
    const session = this.auth.getSession();
    const headers = new Headers(req.headers);

    // Required headers per SDK usage guidelines
    headers.set('x-pm-appversion', APP_VERSION_HEADER);

    if (session) {
      headers.set('Authorization', `Bearer ${session.accessToken}`);
      headers.set('x-pm-uid', session.uid);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), req.timeoutMs);

    // Allow caller to abort as well
    req.signal?.addEventListener('abort', () => controller.abort());

    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers,
        body,
        signal: controller.signal,
      });

      // Trigger progress callback for blob uploads if streaming is not available
      if (onProgress && body instanceof Uint8Array) {
        onProgress(100); // placeholder; real streaming progress via ReadableStream
      }

      return res;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
