import { createHash } from 'node:crypto';
import { DomainError } from '@agorafab/domain';
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { invalidInput } from '../http-validation.js';

export interface ListPageOptions {
  cursor?: string;
  limit?: number | string;
}

interface CursorPosition {
  createdAt: string;
  id: string;
}

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const timestampPattern =
  /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function scopeHash(scope: string): string {
  return createHash('sha256').update(scope).digest('base64url');
}

function invalidCursor(): never {
  throw new DomainError(
    400,
    'INVALID_CURSOR',
    'The cursor is invalid for this list.',
  );
}

function readLimit(rawLimit: ListPageOptions['limit'], defaultLimit: number) {
  const limit = rawLimit === undefined ? defaultLimit : rawLimit;
  let value: number;
  if (typeof limit === 'number') value = limit;
  else if (typeof limit === 'string' && /^\d{1,2}$/.test(limit))
    value = Number(limit);
  else return invalidInput();
  if (!Number.isInteger(value) || value < 1 || value > 50) invalidInput();
  return value;
}

function decodeCursor(cursor: string, scope: string): CursorPosition {
  if (typeof cursor !== 'string' || !/^[a-zA-Z0-9_-]{1,240}$/.test(cursor))
    invalidCursor();
  const bytes = Buffer.from(cursor, 'base64url');
  if (bytes.toString('base64url') !== cursor) invalidCursor();
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    invalidCursor();
  }
  if (!Array.isArray(value) || value.length !== 3) invalidCursor();
  const [hash, createdAt, id]: unknown[] = value;
  if (
    hash !== scopeHash(scope) ||
    typeof createdAt !== 'string' ||
    !timestampPattern.test(createdAt) ||
    typeof id !== 'string' ||
    !uuidPattern.test(id)
  )
    invalidCursor();
  const date = new Date(createdAt);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString() !== `${createdAt.slice(0, 23)}Z`
  )
    invalidCursor();
  return { createdAt, id };
}

export function readCursor(
  options: ListPageOptions,
  scope: string,
  defaultLimit = 20,
) {
  return {
    limit: readLimit(options.limit, defaultLimit),
    position:
      options.cursor === undefined
        ? undefined
        : decodeCursor(options.cursor, scope),
  };
}

/** Keep all PostgreSQL microseconds through the driver and back into the WHERE clause. */
export function cursorTimestamp(column: SQLWrapper): SQL<string> {
  return sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export function cursorBoundary(
  position: CursorPosition | undefined,
  timestamp: SQLWrapper,
  id: SQLWrapper,
  direction: 'asc' | 'desc',
) {
  if (!position) return undefined;
  const operator = direction === 'asc' ? sql`>` : sql`<`;
  return sql`(${timestamp}, ${id}) ${operator} (${position.createdAt}::timestamptz, ${position.id}::uuid)`;
}

/** The extra result row is only used as evidence that another page exists. */
export function slicePage<T extends CursorPosition>(
  rows: T[],
  limit: number,
  scope: string,
) {
  const items = rows.slice(0, limit);
  const tail = items.at(-1);
  const nextCursor =
    rows.length > limit && tail
      ? Buffer.from(
          JSON.stringify([scopeHash(scope), tail.createdAt, tail.id]),
        ).toString('base64url')
      : null;
  return { items, nextCursor };
}
