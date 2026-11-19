import {
  allowsLocalAuthOrigin,
  selectCookies,
  sessionCookies,
} from './account';
import { internalApiRequest, readRequestBody } from './internal-api';

const responseHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

const operations = {
  'github/start': 'POST',
  'github/callback': 'GET',
  'local/login': 'POST',
  'local/activate': 'POST',
  logout: 'POST',
} as const;

function failure(error: string) {
  return new Response(null, {
    status: 303,
    headers: { ...responseHeaders, Location: `/account?error=${error}` },
  });
}

const localFormLimit = 4096;

async function localForm(request: Request, activate: boolean) {
  if (
    request.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase() !== 'application/x-www-form-urlencoded' ||
    Number(request.headers.get('content-length')) > localFormLimit
  )
    return;
  const body = await readRequestBody(request, localFormLimit);
  if (body === null) return;
  const form = new URLSearchParams(body);
  const fields = activate
    ? ['handle', 'password', 'activationCode']
    : ['handle', 'password'];
  if (
    form.size !== fields.length ||
    fields.some((key) => form.getAll(key).length !== 1)
  )
    return;
  return JSON.stringify(Object.fromEntries(form));
}

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
  const local = route === 'local/login' || route === 'local/activate';
  const fetchSite = request.headers.get('sec-fetch-site');
  if (
    local &&
    (!allowsLocalAuthOrigin(origin) ||
      (fetchSite && fetchSite !== 'same-origin'))
  ) {
    return new Response(null, { status: 403, headers: responseHeaders });
  }
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
  const rejection = {
    'github/start': 'sign-in-failed',
    'github/callback': 'sign-in-failed',
    'local/login': 'local-sign-in-failed',
    'local/activate': 'activation-failed',
    logout: 'sign-out-failed',
  }[route];

  try {
    let body: string | undefined;
    if (local) {
      body = await localForm(request, route === 'local/activate');
      if (!body) return failure(rejection);
      headers.set('content-type', 'application/json');
    }
    const upstream = await internalApiRequest(`/api/auth/${route}${query}`, {
      method,
      headers,
      body,
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
      return failure(
        local && upstream.status === 429 ? 'too-many-attempts' : rejection,
      );
    }
  } catch {
    // Do not expose provider or internal API error details to the browser.
  }
  return failure('unavailable');
}
