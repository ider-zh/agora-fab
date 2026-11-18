import type { Database } from './index.js';
import { principals, topics } from './schema.js';

export const fixtureIds = {
  admin: '00000000-0000-4000-8000-000000000001',
  participant: '00000000-0000-4000-8000-000000000002',
  agentA: '00000000-0000-4000-8000-000000000003',
  agentB: '00000000-0000-4000-8000-000000000004',
  community: '00000000-0000-4000-8000-000000000101',
  project: '00000000-0000-4000-8000-000000000102',
} as const;

export function assertFixtureMode(environment: {
  SEED_MODE?: string;
  NODE_ENV?: string;
}): void {
  if (
    environment.SEED_MODE !== 'fixture' ||
    environment.NODE_ENV === 'production'
  ) {
    throw new Error(
      'Fixture seeding requires SEED_MODE=fixture and a non-production NODE_ENV.',
    );
  }
}

export async function seedFixtures(
  database: Database,
  environment: { SEED_MODE?: string; NODE_ENV?: string },
): Promise<void> {
  assertFixtureMode(environment);
  await database.db.transaction(async (transaction) => {
    await transaction
      .insert(principals)
      .values([
        {
          id: fixtureIds.admin,
          kind: 'human',
          handle: 'fixture_admin',
          displayName: 'Fixture Admin',
          role: 'admin',
        },
        {
          id: fixtureIds.participant,
          kind: 'human',
          handle: 'fixture_participant',
          displayName: 'Fixture Participant',
        },
      ])
      .onConflictDoNothing({ target: principals.id });
    await transaction
      .insert(principals)
      .values([
        {
          id: fixtureIds.agentA,
          kind: 'agent',
          handle: 'fixture_agent_a',
          displayName: 'Fixture Agent A',
          ownerPrincipalId: fixtureIds.admin,
          platform: 'fixture-codex',
        },
        {
          id: fixtureIds.agentB,
          kind: 'agent',
          handle: 'fixture_agent_b',
          displayName: 'Fixture Agent B',
          ownerPrincipalId: fixtureIds.participant,
          platform: 'fixture-workbuddy',
        },
      ])
      .onConflictDoNothing({ target: principals.id });
    await transaction
      .insert(topics)
      .values([
        {
          id: fixtureIds.community,
          slug: 'daily-inspiration',
          kind: 'community',
          title: 'Daily Inspiration',
          descriptionMd:
            'Share ideas, questions and evidence with humans and independent agents.',
          createdBy: fixtureIds.admin,
        },
        {
          id: fixtureIds.project,
          slug: 'fixture-project',
          kind: 'project',
          title: 'Example Project',
          descriptionMd:
            'Fixture metadata only; project workflows are planned for M4.',
          goalMd:
            'Demonstrate a persistent Project Topic without implementing tasks or promotion.',
          createdBy: fixtureIds.admin,
        },
      ])
      .onConflictDoNothing({ target: topics.id });
  });
}
