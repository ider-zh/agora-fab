import { createHash } from 'node:crypto';
import { DomainError } from '@agorafab/domain';
import type { FastifyRequest } from 'fastify';

export const sessionTokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const agentTokenPattern = /^agf_[A-Za-z0-9_-]{43}$/;

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sessionCookieName(origin: string): string {
  return origin.startsWith('https://')
    ? '__Host-agorafab_session'
    : 'agorafab_session';
}

export function sessionCookie(
  origin: string,
  token: string,
  maxAge: number,
): string {
  if (
    (maxAge === 0 && token !== '') ||
    (maxAge !== 0 && !sessionTokenPattern.test(token))
  ) {
    throw new Error('Invalid session cookie value.');
  }
  const secure = origin.startsWith('https://') ? '; Secure' : '';
  return `${sessionCookieName(origin)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  const matches = header
    ?.split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  return matches?.length === 1 ? matches[0]?.slice(name.length + 1) : undefined;
}

export function assertOrigin(request: FastifyRequest, origin: string): void {
  if (!origin || request.headers.origin !== origin) {
    throw new DomainError(
      403,
      'INVALID_ORIGIN',
      'The request origin is not allowed.',
    );
  }
}
