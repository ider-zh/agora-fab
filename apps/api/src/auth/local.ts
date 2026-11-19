import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  auditEvents,
  localHumanCredentials,
  principals,
  sessions,
  type Database,
} from '@agorafab/db';
import { DomainError } from '@agorafab/domain';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  idempotencyKey,
  invalidInput,
  requiredText,
  verifiedObject,
} from '../http-validation.js';
import { idempotent } from '../idempotency.js';
import { createTrafficPolicy } from '../traffic.js';
import {
  assertOrigin,
  digest,
  readCookie,
  sessionCookie,
  sessionCookieName,
  sessionTokenPattern,
} from './http.js';
import { serializePrincipal, type IdentityService } from './identity.js';

const deriveKey = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;
const scryptOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const sessionLifetimeSeconds = 7 * 24 * 60 * 60;

function humanHandle(value: unknown) {
  const handle = requiredText(value, 32);
  if (!/^[a-z][a-z0-9_]{2,31}$/.test(handle) || handle.startsWith('gh_'))
    invalidInput();
  return handle;
}

function passwordText(value: unknown) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128)
    invalidInput();
  return value;
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, 32, scryptOptions);
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

async function checkPassword(password: string, encoded: string | null) {
  const parts = /^scrypt:([a-f0-9]{32}):([a-f0-9]{64})$/.exec(encoded ?? '');
  const salt = parts ? Buffer.from(parts[1]!, 'hex') : Buffer.alloc(16);
  const expected = parts ? Buffer.from(parts[2]!, 'hex') : Buffer.alloc(32);
  const derived = await deriveKey(password, salt, 32, scryptOptions);
  return timingSafeEqual(derived, expected) && !!parts;
}

function invalidCredentials(): never {
  throw new DomainError(
    401,
    'INVALID_CREDENTIALS',
    'Invalid account credentials.',
  );
}

function handleUnavailable(): never {
  throw new DomainError(
    409,
    'HANDLE_UNAVAILABLE',
    'This handle is already in use.',
  );
}

export async function bootstrapLocalAdmin(
  database: Database,
  input: { handle: string; displayName: string; password: string },
) {
  const handle = humanHandle(input.handle);
  const displayName = requiredText(input.displayName, 120);
  const passwordHash = await hashPassword(passwordText(input.password));
  return database.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('agorafab:local-admin-bootstrap', 0))`,
    );
    const [existing] = await tx
      .select({ id: principals.id })
      .from(principals)
      .innerJoin(
        localHumanCredentials,
        eq(localHumanCredentials.principalId, principals.id),
      )
      .where(eq(principals.role, 'admin'))
      .limit(1);
    if (existing)
      throw new DomainError(
        409,
        'LOCAL_ADMIN_EXISTS',
        'A local administrator already exists.',
      );
    const [principal] = await tx
      .insert(principals)
      .values({ handle, displayName, kind: 'human', role: 'admin' })
      .onConflictDoNothing({ target: principals.handle })
      .returning();
    if (!principal) handleUnavailable();
    await tx
      .insert(localHumanCredentials)
      .values({ principalId: principal.id, passwordHash });
    await tx.insert(auditEvents).values({
      actorId: principal.id,
      action: 'human.admin.bootstrap',
      targetType: 'principal',
      targetId: principal.id,
      metadataJson: { source: 'deployment_operator' },
    });
    return serializePrincipal(principal);
  });
}

export function registerLocalAuthRoutes(
  app: FastifyInstance,
  database: Database,
  identity: IdentityService,
  traffic: ReturnType<typeof createTrafficPolicy>,
  origin: string,
) {
  app.post('/api/admin/humans', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const actor = traffic.authorize(
      await identity.authenticateMutation(request),
      'admin',
    );
    const key = idempotencyKey(request.headers['idempotency-key']);
    const body = verifiedObject(request.body, ['handle', 'displayName']);
    const input = {
      handle: humanHandle(body.handle),
      displayName: requiredText(body.displayName, 120),
    };
    const result = await idempotent(
      database,
      actor.id,
      'human.invite',
      key,
      input,
      async (tx) => {
        const [principal] = await tx
          .insert(principals)
          .values({ ...input, kind: 'human' })
          .onConflictDoNothing({ target: principals.handle })
          .returning();
        if (!principal) handleUnavailable();
        const activationCode = randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await tx.insert(localHumanCredentials).values({
          principalId: principal.id,
          activationDigest: digest(activationCode),
          activationExpiresAt: expiresAt,
        });
        await tx.insert(auditEvents).values({
          actorId: actor.id,
          action: 'human.invite',
          targetType: 'principal',
          targetId: principal.id,
        });
        return {
          stored: {
            principal: serializePrincipal(principal),
            expiresAt: expiresAt.toISOString(),
          },
          transient: { activationCode },
        };
      },
    );
    return reply
      .code(result.replay ? 200 : 201)
      .send({ ...result.response, ...result.transient });
  });

  for (const action of ['login', 'activate'] as const) {
    app.post(
      `/api/auth/local/${action}`,
      { bodyLimit: 4096 },
      async (request, reply) => {
        reply
          .header('cache-control', 'no-store')
          .header('referrer-policy', 'no-referrer');
        assertOrigin(request, origin);
        const body = verifiedObject(
          request.body,
          action === 'activate'
            ? ['handle', 'password', 'activationCode']
            : ['handle', 'password'],
        );
        const handle = humanHandle(body.handle);
        const password = passwordText(body.password);
        traffic.checkLogin(request.ip, handle);
        const activationCode = body.activationCode;
        let activationDigest: string | undefined;
        if (action === 'activate') {
          if (
            typeof activationCode !== 'string' ||
            !sessionTokenPattern.test(activationCode)
          )
            invalidInput();
          activationDigest = digest(activationCode);
        }
        const [account] = await database.db
          .select({
            id: principals.id,
            passwordHash: localHumanCredentials.passwordHash,
          })
          .from(principals)
          .innerJoin(
            localHumanCredentials,
            eq(localHumanCredentials.principalId, principals.id),
          )
          .where(
            and(
              eq(principals.kind, 'human'),
              eq(principals.status, 'active'),
              eq(principals.handle, handle),
              activationDigest === undefined
                ? undefined
                : and(
                    eq(
                      localHumanCredentials.activationDigest,
                      activationDigest,
                    ),
                    gt(localHumanCredentials.activationExpiresAt, new Date()),
                  ),
            ),
          );
        let newPasswordHash: string | undefined;
        if (activationDigest === undefined) {
          if (
            !(await checkPassword(password, account?.passwordHash ?? null)) ||
            !account
          )
            invalidCredentials();
        } else {
          if (!account) invalidCredentials();
          newPasswordHash = await hashPassword(password);
        }
        const token = randomBytes(32).toString('base64url');
        const previous = readCookie(
          request.headers.cookie,
          sessionCookieName(origin),
        );
        await database.db.transaction(async (tx) => {
          if (activationDigest && newPasswordHash) {
            const [activated] = await tx
              .update(localHumanCredentials)
              .set({
                passwordHash: newPasswordHash,
                activationDigest: null,
                activationExpiresAt: null,
              })
              .where(
                and(
                  eq(localHumanCredentials.principalId, account.id),
                  eq(localHumanCredentials.activationDigest, activationDigest),
                  gt(localHumanCredentials.activationExpiresAt, new Date()),
                ),
              )
              .returning({ id: localHumanCredentials.principalId });
            if (!activated) invalidCredentials();
          }
          if (previous && sessionTokenPattern.test(previous))
            await tx
              .delete(sessions)
              .where(
                and(
                  eq(sessions.principalId, account.id),
                  eq(sessions.tokenHash, digest(previous)),
                ),
              );
          await tx.insert(sessions).values({
            principalId: account.id,
            tokenHash: digest(token),
            expiresAt: new Date(Date.now() + sessionLifetimeSeconds * 1000),
          });
        });
        return reply
          .header(
            'set-cookie',
            sessionCookie(origin, token, sessionLifetimeSeconds),
          )
          .redirect('/account', 303);
      },
    );
  }
}
