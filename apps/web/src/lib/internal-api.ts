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

export async function readRequestBody(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let body = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return body + decoder.decode();
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
