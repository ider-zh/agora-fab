import { selectCookies, sessionCookies } from './account';
import { internalApiRequest } from './internal-api';

const responseHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

const operations = {
  'github/start': 'POST',
  'github/callback': 'GET',
  logout: 'POST',
} as const;

function redirectFor(operation: keyof typeof operations, location: string) {
  if (operation === 'github/start') {
    try {
      const destination = new URL(location);
      if (
        destination.origin === 'https://github.com' &&
        destination.pathname === '/login/oauth/authorize' &&
        !destination.username &&
        !destination.password &&
        !destination.hash
      ) {
        return destination.href;
      }
    } catch {
      return;
    }
  } else if (/^\/account(?:\?error=[a-zA-Z0-9_-]{1,40})?$/.test(location)) {
    return location;
  }
}

export async function proxyAuth(request: Request, segments: string[]) {
  const operation = segments.find((segment) => segment.includes('/'))
    ? ''
    : segments.join('/');
  if (!Object.hasOwn(operations, operation)) {
    return new Response(null, { status: 404, headers: responseHeaders });
  }
  const route = operation as keyof typeof operations;
  const method = operations[route];
  if (request.method !== method) {
    return new Response(null, {
      status: 405,
      headers: { ...responseHeaders, Allow: method },
    });
  }

  const headers = new Headers();
  const origin = request.headers.get('origin');
  if (origin) headers.set('origin', origin);
  const incomingCookies = request.headers.get('cookie');
  const cookie = [
    sessionCookies(incomingCookies),
    selectCookies(incomingCookies, ['__Host-agorafab_oauth', 'agorafab_oauth']),
  ]
    .filter(Boolean)
    .join('; ');
  if (cookie) headers.set('cookie', cookie);
  const query = route === 'github/callback' ? new URL(request.url).search : '';

  try {
    const upstream = await internalApiRequest(`/api/auth/${route}${query}`, {
      method,
      headers,
      signal: AbortSignal.timeout(15000),
    });
    const location = upstream.headers.get('location');
    const target =
      upstream.status === 303 && location && redirectFor(route, location);
    await upstream.body?.cancel();
    if (target) {
      const response = new Response(null, {
        status: 303,
        headers: { ...responseHeaders, Location: target },
      });
      for (const value of upstream.headers.getSetCookie()) {
        response.headers.append('Set-Cookie', value);
      }
      return response;
    }
    if (upstream.status >= 400 && upstream.status < 500) {
      const error = route === 'logout' ? 'sign-out-failed' : 'sign-in-failed';
      return new Response(null, {
        status: 303,
        headers: { ...responseHeaders, Location: `/account?error=${error}` },
      });
    }
  } catch {
    // Do not expose provider or internal API error details to the browser.
  }
  return new Response(null, {
    status: 303,
    headers: { ...responseHeaders, Location: '/account?error=unavailable' },
  });
}
