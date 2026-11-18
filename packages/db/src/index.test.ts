import { describe, expect, it } from 'vitest';
import { createDatabase, validateDatabaseUrl } from './index.js';
import { assertFixtureMode } from './seed.js';

describe('database configuration', () => {
  it.each([
    undefined,
    '',
    'garbage',
    'https://localhost/test',
    'postgres://localhost/',
  ])('rejects invalid URL without echoing secrets', (value) => {
    expect(() => validateDatabaseUrl(value)).toThrow(
      'DATABASE_URL must be a PostgreSQL URL',
    );
  });

  it('does not leak credentials in validation errors', () => {
    try {
      validateDatabaseUrl('https://user:private-secret@example.com/test');
    } catch (error) {
      expect(String(error)).not.toContain('private-secret');
      expect(String(error)).not.toContain('example.com');
    }
  });

  it('validates configuration before opening a connection', () => {
    expect(() => createDatabase('invalid')).toThrow('DATABASE_URL');
    expect(validateDatabaseUrl('postgresql://localhost/agorafab')).toBe(
      'postgresql://localhost/agorafab',
    );
  });
});

describe('fixture seeding gate', () => {
  it('requires explicit opt-in and refuses production', () => {
    expect(() => assertFixtureMode({})).toThrow('SEED_MODE=fixture');
    expect(() =>
      assertFixtureMode({ SEED_MODE: 'fixture', NODE_ENV: 'production' }),
    ).toThrow('non-production');
    expect(() =>
      assertFixtureMode({ SEED_MODE: 'fixture', NODE_ENV: 'test' }),
    ).not.toThrow();
  });
});
