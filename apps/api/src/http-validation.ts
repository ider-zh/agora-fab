import { DomainError } from '@agorafab/domain';

export function invalidInput(): never {
  throw new DomainError(400, 'VALIDATION_ERROR', 'Invalid request.');
}

export function verifiedObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    invalidInput();
  return value as Record<string, unknown>;
}

export function requiredText(value: unknown, max: number): string {
  if (typeof value !== 'string') invalidInput();
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || trimmed.includes('\u0000'))
    invalidInput();
  return trimmed;
}

export function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    invalidInput();
  return value.toLowerCase();
}

export function idempotencyKey(key: string | string[] | undefined): string {
  if (typeof key !== 'string' || !/^[A-Za-z0-9:._-]{1,128}$/.test(key)) {
    throw new DomainError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Supply a valid Idempotency-Key header.',
    );
  }
  return key;
}
