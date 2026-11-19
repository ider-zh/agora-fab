import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig } from '../src/config.js';

const databaseUrl = 'postgresql://fixture:fixture@localhost:5432/agorafab';

describe('API configuration', () => {
  it('uses safe local defaults', () => {
    expect(loadConfig({ DATABASE_URL: databaseUrl })).toEqual({
      databaseUrl,
      host: '127.0.0.1',
      port: 3001,
      nodeEnv: 'development',
    });
  });

  it.each(['http://127.0.0.1:43187', 'https://forum.example.test'])(
    'enables local accounts without GitHub at %s',
    (origin) => {
      const result = loadConfig({
        DATABASE_URL: databaseUrl,
        LOCAL_AUTH_ENABLED: '1',
        AUTH_PUBLIC_ORIGIN: origin,
      });
      expect(result.localAuthOrigin).toBe(origin);
      expect(result.github).toBeUndefined();
    },
  );

  it.each([undefined, 'http://192.168.1.220:43187'])(
    'rejects an absent or plaintext LAN local account origin: %s',
    (origin) => {
      expect(() =>
        loadConfig({
          DATABASE_URL: databaseUrl,
          LOCAL_AUTH_ENABLED: '1',
          AUTH_PUBLIC_ORIGIN: origin,
        }),
      ).toThrow('Invalid configuration: AUTH_PUBLIC_ORIGIN');
    },
  );

  it.each(['0.0.0.0', '::', 'localhost', 'api.internal'])(
    'accepts host %s',
    (host) => {
      expect(
        loadConfig({
          DATABASE_URL: databaseUrl,
          HOST: host,
          PORT: '65535',
          NODE_ENV: 'production',
        }),
      ).toMatchObject({ host, port: 65535, nodeEnv: 'production' });
    },
  );

  it.each([
    {},
    { DATABASE_URL: '' },
    { DATABASE_URL: 'not-a-url-private-secret' },
    { DATABASE_URL: 'https://private-secret@example.com/db' },
    { DATABASE_URL: 'postgresql://localhost' },
    { DATABASE_URL: 'postgresql://localhost/db#private-secret' },
    { DATABASE_URL: ` ${databaseUrl}` },
  ])(
    'rejects invalid database configuration without leaking values: %j',
    (env) => {
      expect(() => loadConfig(env)).toThrow(
        'Invalid configuration: DATABASE_URL',
      );
      try {
        loadConfig(env);
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect(String(error)).not.toContain('private-secret');
        expect((error as ConfigurationError).fields).toEqual(['DATABASE_URL']);
      }
    },
  );

  it.each(['', '0', '-1', '65536', '1.5', '3e3', '3001 ', 'private-secret'])(
    'rejects invalid port %j',
    (port) => {
      expect(() =>
        loadConfig({ DATABASE_URL: databaseUrl, PORT: port }),
      ).toThrow('Invalid configuration: PORT');
    },
  );

  it.each([
    '',
    'https://private-secret',
    'a b',
    '-host',
    'host-',
    'a'.repeat(64),
  ])('rejects invalid host %j', (host) => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, HOST: host })).toThrow(
      'Invalid configuration: HOST',
    );
  });

  it('reports all invalid fields without reporting their values', () => {
    expect(() =>
      loadConfig({ PORT: 'private-secret', HOST: '', NODE_ENV: 'invalid' }),
    ).toThrow('Invalid configuration: DATABASE_URL, HOST, PORT, NODE_ENV');
  });

  it('permits an explicit MCP authority alongside the canonical endpoint', () => {
    const result = loadConfig({
      DATABASE_URL: databaseUrl,
      MCP_PUBLIC_URL: 'https://forum.example.test/mcp',
      MCP_ALLOWED_HOSTS: ' 192.168.1.220:43187, PREVIEW.EXAMPLE.TEST:443 ',
    });
    expect(result.mcp?.allowedHosts).toEqual(
      new Set([
        'forum.example.test',
        '192.168.1.220:43187',
        'preview.example.test:443',
      ]),
    );
    expect(result.mcp?.allowedOrigins.size).toBe(0);
  });

  it.each([
    '*',
    'https://forum.example.test',
    'a.example.test/private',
    'user@forum.example.test',
    'host:65536',
  ])('rejects invalid MCP authority %s', (value) => {
    expect(() =>
      loadConfig({ DATABASE_URL: databaseUrl, MCP_ALLOWED_HOSTS: value }),
    ).toThrow('Invalid configuration: MCP_ALLOWED_HOSTS');
  });
});
