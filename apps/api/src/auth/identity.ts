import {
  agentCredentials,
  auditEvents,
  githubIdentities,
  localHumanCredentials,
  principals,
  sessions,
  type Database,
} from '@agorafab/db';
import {
  DomainError,
  requireAction,
  type AgentScope,
  type AuthContext,
  type Principal,
} from '@agorafab/domain';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import {
  cursorBoundary,
  cursorTimestamp,
  readCursor,
  slicePage,
  type ListPageOptions,
} from '../community/cursor.js';
import { idempotent } from '../idempotency.js';
import { uuidPattern } from '../http-validation.js';
import type { AuthorizeMutation } from '../traffic.js';
import {
  agentTokenPattern,
  assertOrigin,
  digest,
  readCookie,
  sessionCookieName,
  sessionTokenPattern,
} from './http.js';

export function serializePrincipal(
  row: typeof principals.$inferSelect,
): Principal {
  const {
    id,
    kind,
    handle,
    displayName,
    role,
    status,
    ownerPrincipalId,
    platform,
    capabilities,
  } = row;
  return {
    id,
    kind,
    handle,
    displayName,
    role,
    status,
    ownerPrincipalId,
    platform,
    capabilities,
  };
}

interface LoginSource {
  origin: string;
  githubAdminIds?: ReadonlySet<string>;
  localEnabled?: boolean;
}

const agentOwner = alias(principals, 'agent_owner');

export function createIdentityService(
  database: Database,
  login?: LoginSource,
  authorize: AuthorizeMutation = requireAction,
) {
  async function authenticate(
    request: FastifyRequest,
  ): Promise<AuthContext | null> {
    const authorization = request.headers.authorization;
    if (authorization !== undefined) {
      const token = /^Bearer ([^ ]+)$/i.exec(authorization)?.[1];
      if (!token || !agentTokenPattern.test(token)) return null;
      const [result] = await database.db
        .select({
          principal: principals,
          scopes: agentCredentials.scopes,
          credentialId: agentCredentials.id,
        })
        .from(agentCredentials)
        .innerJoin(principals, eq(agentCredentials.agentId, principals.id))
        .where(
          and(
            eq(agentCredentials.tokenHash, digest(token)),
            isNull(agentCredentials.revokedAt),
            gt(agentCredentials.expiresAt, new Date()),
            eq(principals.status, 'active'),
            eq(principals.kind, 'agent'),
          ),
        );
      return result
        ? {
            method: 'bearer',
            principal: serializePrincipal(result.principal),
            scopes: result.scopes,
            credentialId: result.credentialId,
          }
        : null;
    }
    if (!login) return null;
    const token = readCookie(
      request.headers.cookie,
      sessionCookieName(login.origin),
    );
    if (!token || !sessionTokenPattern.test(token)) return null;
    const [result] = await database.db
      .select({
        principal: principals,
        githubId: githubIdentities.githubId,
        localPasswordHash: localHumanCredentials.passwordHash,
      })
      .from(sessions)
      .innerJoin(principals, eq(sessions.principalId, principals.id))
      .leftJoin(
        githubIdentities,
        eq(sessions.principalId, githubIdentities.principalId),
      )
      .leftJoin(
        localHumanCredentials,
        eq(sessions.principalId, localHumanCredentials.principalId),
      )
      .where(
        and(
          eq(sessions.tokenHash, digest(token)),
          gt(sessions.expiresAt, new Date()),
          eq(principals.status, 'active'),
          eq(principals.kind, 'human'),
        ),
      );
    if (!result) return null;
    const principal = serializePrincipal(result.principal);
    if (result.githubId) {
      if (!login.githubAdminIds) return null;
      if (!login.githubAdminIds.has(result.githubId))
        principal.role = 'participant';
    } else if (!login.localEnabled || !result.localPasswordHash) {
      return null;
    }
    return { method: 'session', principal };
  }

  async function authenticateMutation(
    request: FastifyRequest,
  ): Promise<AuthContext | null> {
    const auth = await authenticate(request);
    if (auth?.method === 'session') assertOrigin(request, login?.origin ?? '');
    return auth;
  }

  async function logout(request: FastifyRequest): Promise<void> {
    if (!login)
      throw new DomainError(
        404,
        'AUTH_DISABLED',
        'Browser sign-in is unavailable.',
      );
    assertOrigin(request, login.origin);
    const token = readCookie(
      request.headers.cookie,
      sessionCookieName(login.origin),
    );
    if (token && sessionTokenPattern.test(token))
      await database.db
        .delete(sessions)
        .where(eq(sessions.tokenHash, digest(token)));
  }

  async function inviteAgent(
    auth: AuthContext | null,
    key: string,
    input: {
      handle: string;
      displayName: string;
      ownerPrincipalId?: string;
      ownerHandle?: string;
      platform: string;
      capabilities: string[];
    },
  ) {
    const actor = authorize(auth, 'admin');
    return idempotent(
      database,
      actor.id,
      'agent.invite',
      key,
      input,
      async (tx) => {
        const [owner] = await tx
          .select({ id: principals.id })
          .from(principals)
          .where(
            and(
              input.ownerPrincipalId
                ? eq(principals.id, input.ownerPrincipalId)
                : eq(principals.handle, input.ownerHandle ?? ''),
              eq(principals.kind, 'human'),
              eq(principals.status, 'active'),
            ),
          )
          .for('share');
        if (!owner)
          throw new DomainError(
            422,
            'INVALID_OWNER',
            'The owner must be an active human principal.',
          );
        const [row] = await tx
          .insert(principals)
          .values({
            handle: input.handle,
            displayName: input.displayName,
            ownerPrincipalId: owner.id,
            platform: input.platform,
            capabilities: input.capabilities,
            kind: 'agent',
          })
          .onConflictDoNothing({ target: principals.handle })
          .returning();
        if (!row)
          throw new DomainError(
            409,
            'HANDLE_UNAVAILABLE',
            'This handle is already in use.',
          );
        await tx.insert(auditEvents).values({
          actorId: actor.id,
          action: 'agent.invite',
          targetType: 'principal',
          targetId: row.id,
        });
        return { stored: { principal: serializePrincipal(row) } };
      },
    );
  }

  async function issueToken(
    auth: AuthContext | null,
    key: string,
    input: { agentId: string; scopes: AgentScope[]; expiresInHours: number },
  ) {
    const actor = authorize(auth, 'admin');
    return idempotent(
      database,
      actor.id,
      'agent.token.issue',
      key,
      input,
      async (tx) => {
        const [agent] = await tx
          .select({ id: principals.id })
          .from(principals)
          .where(
            and(
              eq(principals.id, input.agentId),
              eq(principals.kind, 'agent'),
              eq(principals.status, 'active'),
            ),
          )
          .for('share');
        if (!agent)
          throw new DomainError(
            404,
            'AGENT_NOT_FOUND',
            'Active agent not found.',
          );
        const token = `agf_${randomBytes(32).toString('base64url')}`;
        const expiresAt = new Date(
          Date.now() + input.expiresInHours * 60 * 60 * 1000,
        );
        const scopes = input.scopes;
        const [credential] = await tx
          .insert(agentCredentials)
          .values({
            agentId: agent.id,
            tokenHash: digest(token),
            scopes,
            expiresAt,
            createdBy: actor.id,
          })
          .returning({ id: agentCredentials.id });
        if (!credential) throw new Error('Credential insert failed.');
        await tx.insert(auditEvents).values({
          actorId: actor.id,
          action: 'agent.token.issue',
          targetType: 'agent_credential',
          targetId: credential.id,
          metadataJson: { agentId: agent.id, scopes },
        });
        return {
          stored: {
            credential: {
              id: credential.id,
              agentId: agent.id,
              scopes,
              expiresAt: expiresAt.toISOString(),
            },
          },
          transient: { token },
        };
      },
    );
  }

  async function revokeToken(
    auth: AuthContext | null,
    agentId: string,
    credentialId: string,
  ) {
    const actor = authorize(auth, 'admin');
    await database.db.transaction(async (tx) => {
      const where = and(
        eq(agentCredentials.id, credentialId),
        eq(agentCredentials.agentId, agentId),
      );
      const [changed] = await tx
        .update(agentCredentials)
        .set({ revokedAt: new Date() })
        .where(and(where, isNull(agentCredentials.revokedAt)))
        .returning({ id: agentCredentials.id });
      if (changed) {
        await tx.insert(auditEvents).values({
          actorId: actor.id,
          action: 'agent.token.revoke',
          targetType: 'agent_credential',
          targetId: credentialId,
          metadataJson: { agentId },
        });
      } else {
        const [existing] = await tx
          .select({ id: agentCredentials.id })
          .from(agentCredentials)
          .where(where);
        if (!existing)
          throw new DomainError(
            404,
            'CREDENTIAL_NOT_FOUND',
            'Credential not found.',
          );
      }
    });
  }

  async function revokeAgent(auth: AuthContext | null, agentId: string) {
    const actor = authorize(auth, 'admin');
    await database.db.transaction(async (tx) => {
      const target = and(
        eq(principals.id, agentId),
        eq(principals.kind, 'agent'),
      );
      const now = new Date();
      const [changed] = await tx
        .update(principals)
        .set({ status: 'revoked', updatedAt: now })
        .where(and(target, eq(principals.status, 'active')))
        .returning({ id: principals.id });
      if (!changed) {
        const [existing] = await tx
          .select({ id: principals.id })
          .from(principals)
          .where(target);
        if (!existing)
          throw new DomainError(404, 'AGENT_NOT_FOUND', 'Agent not found.');
        return;
      }
      await tx
        .update(agentCredentials)
        .set({ revokedAt: now })
        .where(
          and(
            eq(agentCredentials.agentId, agentId),
            isNull(agentCredentials.revokedAt),
          ),
        );
      await tx.insert(auditEvents).values({
        actorId: actor.id,
        action: 'agent.revoke',
        targetType: 'principal',
        targetId: agentId,
      });
    });
  }

  async function listAgents(
    auth: AuthContext | null,
    options: ListPageOptions,
  ) {
    requireAction(auth, 'admin');
    const scope = 'admin:agents';
    const { limit, position } = readCursor(options, scope);
    const rows = await database.db
      .select({
        principal: principals,
        ownerHandle: agentOwner.handle,
        createdAt: cursorTimestamp(principals.createdAt),
      })
      .from(principals)
      .innerJoin(agentOwner, eq(agentOwner.id, principals.ownerPrincipalId))
      .where(
        and(
          eq(principals.kind, 'agent'),
          cursorBoundary(position, principals.createdAt, principals.id, 'desc'),
        ),
      )
      .orderBy(desc(principals.createdAt), desc(principals.id))
      .limit(limit + 1);
    return slicePage(
      rows.map(({ principal, ownerHandle, createdAt }) => ({
        ...serializePrincipal(principal),
        ownerHandle,
        createdAt,
      })),
      limit,
      scope,
    );
  }

  async function getAgent(auth: AuthContext | null, reference: string) {
    requireAction(auth, 'admin');
    const [row] = await database.db
      .select({ principal: principals, ownerHandle: agentOwner.handle })
      .from(principals)
      .innerJoin(agentOwner, eq(agentOwner.id, principals.ownerPrincipalId))
      .where(
        and(
          eq(principals.kind, 'agent'),
          uuidPattern.test(reference)
            ? eq(principals.id, reference)
            : eq(principals.handle, reference),
        ),
      );
    if (!row) throw new DomainError(404, 'AGENT_NOT_FOUND', 'Agent not found.');
    return {
      ...serializePrincipal(row.principal),
      ownerHandle: row.ownerHandle,
    };
  }

  async function listTokens(auth: AuthContext | null, agentId: string) {
    requireAction(auth, 'admin');
    const { id, scopes, expiresAt, revokedAt, createdAt } = agentCredentials;
    return database.db
      .select({ id, scopes, expiresAt, revokedAt, createdAt })
      .from(agentCredentials)
      .where(eq(agentCredentials.agentId, agentId))
      .orderBy(desc(createdAt), desc(id))
      .limit(100);
  }

  return {
    authenticate,
    authenticateMutation,
    logout,
    inviteAgent,
    issueToken,
    revokeToken,
    revokeAgent,
    listAgents,
    getAgent,
    listTokens,
  };
}

export type IdentityService = ReturnType<typeof createIdentityService>;
