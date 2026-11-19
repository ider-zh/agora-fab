import { internalApiRequest } from './internal-api';

const sessionNames = ['agorafab_session', '__Host-agorafab_session'];

export function selectCookies(header: string | null, names: readonly string[]) {
  return (header ?? '')
    .split(';')
    .map((cookie) => cookie.trim())
    .filter((cookie) => names.includes(cookie.split('=', 1)[0] ?? ''))
    .join('; ');
}

export function sessionCookies(header: string | null) {
  return selectCookies(header, sessionNames);
}

export function allowsLocalAuthOrigin(origin: string | null) {
  const configured = process.env.AUTH_PUBLIC_ORIGIN;
  if (!origin || (configured && origin !== configured)) return false;
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}

export function canShowLocalAuth(headers: Headers) {
  const protocol = headers.get('x-forwarded-proto') ?? 'http';
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  return allowsLocalAuthOrigin(`${protocol}://${host ?? ''}`);
}

interface HumanProfile {
  id: string;
  displayName: string;
  handle: string;
  role: 'admin' | 'participant';
}

type Account =
  | { status: 'signed-in'; profile: HumanProfile }
  | ({ status: 'signed-out' } & LoginModes)
  | { status: 'unavailable' };

interface LoginModes {
  githubEnabled: boolean;
  localEnabled: boolean;
}

function humanProfile(data: unknown): HumanProfile | undefined {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('principal' in data) ||
    typeof data.principal !== 'object' ||
    data.principal === null
  ) {
    return;
  }
  const principal = data.principal as Record<string, unknown>;
  if (
    principal.kind === 'human' &&
    principal.status === 'active' &&
    typeof principal.id === 'string' &&
    typeof principal.displayName === 'string' &&
    typeof principal.handle === 'string' &&
    (principal.role === 'admin' || principal.role === 'participant')
  ) {
    return {
      id: principal.id,
      displayName: principal.displayName,
      handle: principal.handle,
      role: principal.role,
    };
  }
}

export async function getLoginModes(): Promise<LoginModes | undefined> {
  try {
    const response = await internalApiRequest('/api/auth/config');
    if (!response.ok) return;
    const data: unknown = await response.json();
    if (
      typeof data === 'object' &&
      data !== null &&
      'githubEnabled' in data &&
      typeof data.githubEnabled === 'boolean'
    ) {
      return {
        githubEnabled: data.githubEnabled,
        localEnabled: 'localEnabled' in data && data.localEnabled === true,
      };
    }
  } catch {
    // If configuration cannot be checked, hide unavailable login methods.
  }
}

export async function getAccount(
  cookieHeader: string | null,
): Promise<Account> {
  try {
    const cookie = sessionCookies(cookieHeader);
    if (cookie) {
      const response = await internalApiRequest('/api/me', {
        headers: { cookie },
      });
      if (response.ok) {
        const profile = humanProfile(await response.json());
        return profile
          ? { status: 'signed-in', profile }
          : { status: 'unavailable' };
      }
      if (response.status !== 401) return { status: 'unavailable' };
    }
    const modes = await getLoginModes();
    if (modes) return { status: 'signed-out', ...modes };
  } catch {
    // Return a fixed status. Exceptions may contain connection details.
  }
  return { status: 'unavailable' };
}
