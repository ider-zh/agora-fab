import { allowsLocalAuthOrigin, sessionCookies } from './account';
import { internalApiRequest, readRequestBody } from './internal-api';

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const idempotencyKey = /^[a-zA-Z0-9:._-]{1,128}$/;
const maxBytes = 64 * 1024;
const responseHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function jsonError(status: number, code: string) {
  return Response.json(
    { error: { code } },
    { status, headers: responseHeaders },
  );
}

function allowedMutations(segments: readonly string[]) {
  const [first, second = '', third, fourth, fifth] = segments;
  if (segments.length === 3) {
    if (
      first === 'topics' &&
      second.length <= 100 &&
      (uuid.test(second) || slug.test(second)) &&
      third === 'posts'
    )
      return ['POST'];
    if (first === 'posts' && uuid.test(second) && third === 'replies')
      return ['POST'];
    if (first === 'me' && second === 'notifications' && uuid.test(third ?? ''))
      return ['PATCH'];
    if (first === 'admin' && second === 'topics' && uuid.test(third ?? ''))
      return ['PATCH'];
    if (first === 'projects' && uuid.test(second) && third === 'tasks')
      return ['POST'];
    if (
      first === 'tasks' &&
      uuid.test(second) &&
      ['claim', 'artifacts', 'review'].includes(third ?? '')
    )
      return ['POST'];
    if (first === 'admin' && second === 'tasks' && uuid.test(third ?? ''))
      return ['PATCH'];
    if (first === 'admin' && second === 'agents') {
      if (third === 'suggest') return ['POST'];
      if (uuid.test(third ?? '')) return ['PATCH', 'DELETE'];
    }
  }
  if (
    segments.length === 2 &&
    first === 'admin' &&
    ['topics', 'agents', 'humans'].includes(second)
  )
    return ['POST'];
  if (segments.length === 4 && first === 'admin' && uuid.test(third ?? '')) {
    if (
      second === 'posts' &&
      ['hide', 'restore', 'pin', 'unpin', 'promote'].includes(fourth ?? '')
    )
      return ['POST'];
    if (second === 'projects' && fourth === 'tasks') return ['POST'];
    if (second === 'tasks' && fourth === 'review') return ['POST'];
    if (second === 'agents' && fourth === 'credentials') return ['POST'];
  }
  if (
    segments.length === 5 &&
    first === 'admin' &&
    second === 'agents' &&
    uuid.test(third ?? '') &&
    fourth === 'credentials' &&
    uuid.test(fifth ?? '')
  )
    return ['DELETE'];
}

export async function proxyCommunity(request: Request, segments: string[]) {
  const methods = allowedMutations(segments);
  if (!methods) return jsonError(404, 'NOT_FOUND');
  const method = request.method;
  if (!methods.includes(method))
    return new Response(null, {
      status: 405,
      headers: { ...responseHeaders, Allow: methods.join(', ') },
    });

  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (
    !origin ||
    origin === 'null' ||
    (segments.join('/') === 'admin/humans' && !allowsLocalAuthOrigin(origin)) ||
    (fetchSite && fetchSite !== 'same-origin')
  )
    return jsonError(403, 'INVALID_ORIGIN');
  const cookie = sessionCookies(request.headers.get('cookie'));
  if (!cookie) return jsonError(401, 'UNAUTHORIZED');
  if (
    request.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase() !== 'application/json'
  )
    return jsonError(415, 'UNSUPPORTED_MEDIA_TYPE');
  if (Number(request.headers.get('content-length')) > maxBytes)
    return jsonError(413, 'PAYLOAD_TOO_LARGE');

  // Fastify confirms that Origin exactly matches the configured Web origin.
  const headers = new Headers({
    origin,
    cookie,
    'content-type': 'application/json',
  });
  const key = request.headers.get('idempotency-key');
  if (key) {
    if (!idempotencyKey.test(key))
      return jsonError(400, 'IDEMPOTENCY_KEY_REQUIRED');
    headers.set('idempotency-key', key);
  }
  let body: string | null;
  try {
    body = await readRequestBody(request, maxBytes);
    if (body === null) return jsonError(413, 'PAYLOAD_TOO_LARGE');
    const data: unknown = JSON.parse(body);
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return jsonError(400, 'VALIDATION_ERROR');
  } catch {
    return jsonError(400, 'VALIDATION_ERROR');
  }

  try {
    const upstream = await internalApiRequest(`/api/${segments.join('/')}`, {
      method,
      body,
      headers,
    });
    if (upstream.status === 204)
      return new Response(null, { status: 204, headers: responseHeaders });
    if (
      upstream.status >= 200 &&
      upstream.status < 500 &&
      upstream.headers.get('content-type')?.startsWith('application/json') &&
      (upstream.ok || upstream.status >= 400)
    ) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          ...responseHeaders,
          'Content-Type': 'application/json; charset=utf-8',
        },
      });
    }
    await upstream.body?.cancel();
  } catch {
    // Keep upstream failure details out of responses.
  }
  return jsonError(503, 'SERVICE_UNAVAILABLE');
}
