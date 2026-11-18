export function internalApiRequest(path: string, init: RequestInit = {}) {
  const base = new URL(process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001');
  const url = new URL(path, base);
  if (url.origin !== base.origin) {
    throw new Error('Internal API requests must use the configured origin.');
  }
  return fetch(url, {
    ...init,
    redirect: 'manual',
    cache: 'no-store',
    signal: init.signal ?? AbortSignal.timeout(5000),
  });
}
