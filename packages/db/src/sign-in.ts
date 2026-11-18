import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './index.js';
import {
  auditEvents,
  githubIdentities,
  principals,
  sessions,
} from './schema.js';

type GitHubProfile = {
  id: string;
  login: string;
  displayName: string;
};

type SignInOptions = {
  adminIds: ReadonlySet<string>;
  sessionHash: string;
  expiresAt: Date;
  previousSessionHash?: string;
};

function normalizeDisplayName(value: string): string {
  return value.replace(/\p{Cc}/gu, '').trim();
}

export class GitHubSignInError extends Error {
  constructor(readonly code: 'INVALID_IDENTITY' | 'PRINCIPAL_REVOKED') {
    super(
      code === 'PRINCIPAL_REVOKED'
        ? 'This principal cannot sign in.'
        : 'Invalid GitHub identity or session.',
    );
    this.name = 'GitHubSignInError';
  }
}

export async function signInGitHub(
  database: Database,
  profile: GitHubProfile,
  options: SignInOptions,
): Promise<void> {
  const now = new Date();
  if (
    !/^[1-9][0-9]{0,19}$/.test(profile.id) ||
    !/^[a-f0-9]{64}$/.test(options.sessionHash) ||
    !Number.isFinite(options.expiresAt.getTime()) ||
    options.expiresAt <= now
  ) {
    throw new GitHubSignInError('INVALID_IDENTITY');
  }
  const handle = `gh_${profile.id}`;
  const displayName = Array.from(
    normalizeDisplayName(profile.displayName) ||
      normalizeDisplayName(profile.login) ||
      handle,
  )
    .slice(0, 120)
    .join('');
  const role = options.adminIds.has(profile.id) ? 'admin' : 'participant';

  await database.db.transaction(async (transaction) => {
    // Serialize the initial insert as well as later updates of this identity.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`agorafab:github:${profile.id}`}, 0))`,
    );
    const [identity] = await transaction
      .select({
        id: principals.id,
        kind: principals.kind,
        role: principals.role,
        status: principals.status,
      })
      .from(githubIdentities)
      .innerJoin(principals, eq(githubIdentities.principalId, principals.id))
      .where(eq(githubIdentities.githubId, profile.id))
      .for('update', { of: principals });

    let principalId: string;
    if (identity) {
      if (identity.kind !== 'human' || identity.status !== 'active') {
        throw new GitHubSignInError('PRINCIPAL_REVOKED');
      }
      principalId = identity.id;
      await transaction
        .update(principals)
        .set({ displayName, role, updatedAt: now })
        .where(eq(principals.id, principalId));
    } else {
      const [principal] = await transaction
        .insert(principals)
        .values({ kind: 'human', handle, displayName, role })
        .returning({ id: principals.id });
      if (!principal) throw new Error('Principal was not inserted.');
      principalId = principal.id;
      await transaction.insert(githubIdentities).values({
        githubId: profile.id,
        principalId,
      });
    }

    const previousRole = identity?.role ?? null;
    if ((previousRole ?? 'participant') !== role) {
      await transaction.insert(auditEvents).values({
        actorId: principalId,
        action: 'principal.role_synced',
        targetType: 'principal',
        targetId: principalId,
        metadataJson: { previousRole, role, source: 'github_admin_allowlist' },
      });
    }
    if (options.previousSessionHash) {
      await transaction
        .delete(sessions)
        .where(
          and(
            eq(sessions.tokenHash, options.previousSessionHash),
            eq(sessions.principalId, principalId),
          ),
        );
    }
    await transaction.insert(sessions).values({
      tokenHash: options.sessionHash,
      principalId,
      expiresAt: options.expiresAt,
    });
  });
}
