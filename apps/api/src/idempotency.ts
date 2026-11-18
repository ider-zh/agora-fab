import { idempotencyRecords, type Database } from '@agorafab/db';
import { DomainError } from '@agorafab/domain';
import { and, eq, sql } from 'drizzle-orm';
import { digest } from './auth/http.js';

export type Transaction = Parameters<
  Parameters<Database['db']['transaction']>[0]
>[0];

/** The side effect and replay response commit together under the same key. */
export async function idempotent<T extends Record<string, unknown>>(
  database: Database,
  principalId: string,
  operation: string,
  key: string,
  input: unknown,
  perform: (
    transaction: Transaction,
  ) => Promise<{ stored: T; transient?: Record<string, unknown> }>,
): Promise<{
  response: T;
  transient?: Record<string, unknown>;
  replay: boolean;
}> {
  const requestHash = digest(JSON.stringify(input));
  return database.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([principalId, operation, key])}, 1))`,
    );
    const [existing] = await tx
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.principalId, principalId),
          eq(idempotencyRecords.operation, operation),
          eq(idempotencyRecords.key, key),
        ),
      );
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new DomainError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This key was already used with different input.',
        );
      return { response: existing.responseJson as T, replay: true };
    }
    const { stored, transient } = await perform(tx);
    await tx.insert(idempotencyRecords).values({
      principalId,
      operation,
      key,
      requestHash,
      responseJson: stored,
    });
    return { response: stored, transient, replay: false };
  });
}
