import { sessionCookies } from './account';
import { internalApiRequest } from './internal-api';

export type ReadResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'not-found' | 'denied' | 'invalid' | 'unavailable' };

export async function readCommunity<T>(
  path: string,
  cookies?: string | null,
): Promise<ReadResult<T>> {
  try {
    const cookie = sessionCookies(cookies ?? null);
    const response = await internalApiRequest(path, {
      headers: cookie ? { cookie } : {},
    });
    if (response.ok)
      return { status: 'ok', data: (await response.json()) as T };
    await response.body?.cancel();
    switch (response.status) {
      case 400:
        return { status: 'invalid' };
      case 401:
      case 403:
        return { status: 'denied' };
      case 404:
        return { status: 'not-found' };
    }
  } catch {
    // Network and decoding details stay inside the internal boundary.
  }
  return { status: 'unavailable' };
}
