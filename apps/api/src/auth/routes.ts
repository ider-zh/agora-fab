import {
  agentScopes,
  requireAction,
  requirePrincipal,
  type AgentScope,
} from '@agorafab/domain';
import type { FastifyInstance } from 'fastify';
import type { ListPageOptions } from '../community/cursor.js';
import {
  idempotencyKey,
  invalidInput,
  requiredText,
  uuid,
  verifiedObject,
} from '../http-validation.js';
import { sessionCookie } from './http.js';
import type { IdentityService } from './identity.js';

function labels(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 16) invalidInput();
  return [...new Set(value.map((label) => requiredText(label, 64)))].sort();
}

export function registerIdentityRoutes(
  app: FastifyInstance,
  identity: IdentityService,
  origin?: string,
) {
  app.get('/api/me', async (request) => ({
    principal: requirePrincipal(await identity.authenticate(request)).principal,
  }));

  app.post('/api/auth/logout', async (request, reply) => {
    await identity.logout(request);
    return reply
      .header('set-cookie', sessionCookie(origin ?? '', '', 0))
      .header('referrer-policy', 'no-referrer')
      .redirect('/account', 303);
  });

  app.post('/api/admin/agents', async (request, reply) => {
    const auth = await identity.authenticateMutation(request);
    requireAction(auth, 'admin');
    const key = idempotencyKey(request.headers['idempotency-key']);
    const body = verifiedObject(request.body, [
      'handle',
      'displayName',
      'ownerPrincipalId',
      'platform',
      'capabilities',
    ]);
    const rawHandle = requiredText(body.handle, 32);
    if (!/^[a-z][a-z0-9_]{2,31}$/i.test(rawHandle)) invalidInput();
    const handle = rawHandle.toLowerCase();
    if (handle.startsWith('gh_')) invalidInput();
    const result = await identity.inviteAgent(auth, key, {
      handle,
      displayName: requiredText(body.displayName, 120),
      ownerPrincipalId: uuid(body.ownerPrincipalId),
      platform: requiredText(body.platform, 64),
      capabilities: labels(body.capabilities ?? []),
    });
    return reply.code(result.replay ? 200 : 201).send(result.response);
  });

  app.get<{ Querystring: ListPageOptions }>(
    '/api/admin/agents',
    async (request) =>
      identity.listAgents(await identity.authenticate(request), request.query),
  );
  app.get<{ Params: { agentId: string } }>(
    '/api/admin/agents/:agentId',
    async (request) => ({
      principal: await identity.getAgent(
        await identity.authenticate(request),
        uuid(request.params.agentId),
      ),
    }),
  );

  app.patch<{ Params: { agentId: string } }>(
    '/api/admin/agents/:agentId',
    async (request) => {
      const auth = await identity.authenticateMutation(request);
      requireAction(auth, 'admin');
      const key = idempotencyKey(request.headers['idempotency-key']);
      const body = verifiedObject(request.body, ['displayName']);
      const { response } = await identity.renameAgent(auth, key, {
        agentId: uuid(request.params.agentId),
        displayName: requiredText(body.displayName, 120),
      });
      return response;
    },
  );

  app.get<{ Params: { agentId: string } }>(
    '/api/admin/agents/:agentId/credentials',
    async (request) => ({
      credentials: await identity.listTokens(
        await identity.authenticate(request),
        uuid(request.params.agentId),
      ),
    }),
  );

  app.post<{ Params: { agentId: string } }>(
    '/api/admin/agents/:agentId/credentials',
    async (request, reply) => {
      const auth = await identity.authenticateMutation(request);
      requireAction(auth, 'admin');
      const key = idempotencyKey(request.headers['idempotency-key']);
      const body = verifiedObject(request.body, [
        'scopes',
        'expiresInHours',
        'replacesCredentialId',
      ]);
      if (
        !Array.isArray(body.scopes) ||
        !body.scopes.length ||
        body.scopes.length > agentScopes.length ||
        body.scopes.some(
          (scope: unknown) =>
            typeof scope !== 'string' ||
            !agentScopes.includes(scope as AgentScope),
        )
      )
        invalidInput();
      const scopes = [...new Set(body.scopes as AgentScope[])].sort();
      const expiresInHours = body.expiresInHours ?? 168;
      if (
        typeof expiresInHours !== 'number' ||
        !Number.isInteger(expiresInHours) ||
        expiresInHours < 1 ||
        expiresInHours > 720
      )
        invalidInput();
      const result = await identity.issueToken(auth, key, {
        agentId: uuid(request.params.agentId),
        scopes,
        expiresInHours,
        replacesCredentialId:
          body.replacesCredentialId === undefined
            ? undefined
            : uuid(body.replacesCredentialId),
      });
      return reply
        .code(result.replay ? 200 : 201)
        .send({ ...result.response, ...result.transient });
    },
  );

  app.delete<{ Params: { agentId: string } }>(
    '/api/admin/agents/:agentId',
    async (request, reply) => {
      await identity.revokeAgent(
        await identity.authenticateMutation(request),
        uuid(request.params.agentId),
      );
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { agentId: string; credentialId: string } }>(
    '/api/admin/agents/:agentId/credentials/:credentialId',
    async (request, reply) => {
      await identity.revokeToken(
        await identity.authenticateMutation(request),
        uuid(request.params.agentId),
        uuid(request.params.credentialId),
      );
      return reply.code(204).send();
    },
  );
}
