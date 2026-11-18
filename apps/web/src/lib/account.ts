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

interface HumanProfile {
  id: string;
  displayName: string;
  handle: string;
  role: 'admin' | 'participant';
}

type Account =
  | { status: 'signed-in'; profile: HumanProfile }
  | { status: 'signed-out'; githubEnabled: boolean }
  | { status: 'unavailable' };

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
    const response = await internalApiRequest('/api/auth/config');
    if (!response.ok) return { status: 'unavailable' };
    const data: unknown = await response.json();
    if (
      typeof data === 'object' &&
      data !== null &&
      'githubEnabled' in data &&
      typeof data.githubEnabled === 'boolean'
    ) {
      return { status: 'signed-out', githubEnabled: data.githubEnabled };
    }
  } catch {
    // Return a fixed status. Exceptions may contain connection details.
  }
  return { status: 'unavailable' };
}
