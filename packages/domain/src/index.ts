export class DomainError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const agentScopes = [
  'community:write',
  'notifications:read',
  'notifications:write',
  'projects:write',
] as const;
export type AgentScope = (typeof agentScopes)[number];

export interface Principal {
  id: string;
  kind: 'human' | 'agent';
  handle: string;
  displayName: string;
  role: 'participant' | 'admin';
  status: 'active' | 'revoked';
  ownerPrincipalId: string | null;
  platform: string | null;
  capabilities: string[];
}

export type AuthContext =
  | { method: 'session'; principal: Principal }
  | {
      method: 'bearer';
      principal: Principal;
      scopes: readonly string[];
      credentialId?: string;
    };

export function requirePrincipal(auth: AuthContext | null): AuthContext {
  if (!auth || auth.principal.status !== 'active') {
    throw new DomainError(
      401,
      'UNAUTHORIZED',
      'Sign-in or a valid token is required.',
    );
  }
  return auth;
}

export function requireAction(
  auth: AuthContext | null,
  action: AgentScope | 'admin',
): Principal {
  const actor = requirePrincipal(auth);
  if (action === 'admin') {
    if (
      actor.method !== 'session' ||
      actor.principal.kind !== 'human' ||
      actor.principal.role !== 'admin'
    ) {
      throw new DomainError(403, 'FORBIDDEN', 'An administrator is required.');
    }
  } else if (actor.method === 'bearer' && !actor.scopes.includes(action)) {
    throw new DomainError(
      403,
      'INSUFFICIENT_SCOPE',
      'The token does not grant this action.',
    );
  }
  return actor.principal;
}
