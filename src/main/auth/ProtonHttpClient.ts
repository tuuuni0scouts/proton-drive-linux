/**
 * Thin HTTP client for Proton core API calls that happen BEFORE
 * the SDK is initialised (auth, key fetching, etc.).
 *
 * The SDK drives all subsequent Drive API calls through its own
 * ProtonDriveHTTPClient adapter (DriveHttpClient.ts).
 */
import { APP_VERSION_HEADER, PROTON_CORE_API } from '../../shared/constants';
import type { ProtonSession } from './SessionStore';

interface ProtonRequestOptions {
  method?: string;
  path: string;
  json?: unknown;
  signal?: AbortSignal;
}

function buildHeaders(session?: ProtonSession | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-pm-appversion': APP_VERSION_HEADER,
    Accept: 'application/vnd.protonmail.v1+json',
  };
  if (session) {
    headers['Authorization'] = `Bearer ${session.accessToken}`;
    headers['x-pm-uid'] = session.uid;
  }
  return headers;
}

export async function protonRequest<T = unknown>(
  options: ProtonRequestOptions,
  session?: ProtonSession | null,
): Promise<T> {
  const { method = 'GET', path, json, signal } = options;
  const url = `${PROTON_CORE_API}${path}`;

  const res = await fetch(url, {
    method,
    headers: buildHeaders(session),
    body: json !== undefined ? JSON.stringify(json) : undefined,
    signal,
  });

  const body = await res.json() as { Code: number; Error?: string } & T;

  if (body.Code !== 1000) {
    throw new ProtonApiError(body.Error ?? `API error ${body.Code}`, body.Code, res.status);
  }

  return body;
}

export class ProtonApiError extends Error {
  constructor(
    message: string,
    public readonly apiCode: number,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'ProtonApiError';
  }
}
