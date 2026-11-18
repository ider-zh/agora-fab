import { isIP } from 'node:net';
import type { GitHubConfig } from './auth/github.js';

export interface ApiConfig {
  databaseUrl: string;
  host: string;
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  github?: GitHubConfig;
  mcp?: {
    allowedHosts: ReadonlySet<string>;
    allowedOrigins: ReadonlySet<string>;
  };
}

export class ConfigurationError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super(`Invalid configuration: ${fields.join(', ')}`);
    this.name = 'ConfigurationError';
    this.fields = fields;
  }
}

/** Validate before constructing clients; error messages contain field names only. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const fields: string[] = [];
  const databaseUrl = env.DATABASE_URL ?? '';
  try {
    const url = new URL(databaseUrl);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length < 2 ||
      url.hash ||
      databaseUrl.trim() !== databaseUrl
    ) {
      fields.push('DATABASE_URL');
    }
  } catch {
    fields.push('DATABASE_URL');
  }

  const host = env.HOST ?? '127.0.0.1';
  if (
    !isIP(host) &&
    !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
      host,
    )
  ) {
    fields.push('HOST');
  }

  const rawPort = env.PORT ?? '3001';
  const port = Number(rawPort);
  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    fields.push('PORT');
  }

  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    fields.push('NODE_ENV');
  }
  const clientId = env.GITHUB_OAUTH_CLIENT_ID || undefined;
  const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET || undefined;
  const origin = env.AUTH_PUBLIC_ORIGIN || undefined;
  const adminIds = new Set(
    (env.GITHUB_ADMIN_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
  if ([...adminIds].some((id) => !/^[1-9][0-9]{0,15}$/.test(id)))
    fields.push('GITHUB_ADMIN_IDS');
  if (clientId || clientSecret || origin || adminIds.size) {
    if (!clientId || !/^[A-Za-z0-9_]{1,128}$/.test(clientId))
      fields.push('GITHUB_OAUTH_CLIENT_ID');
    if (!clientSecret || !/^[A-Za-z0-9_]{1,512}$/.test(clientSecret))
      fields.push('GITHUB_OAUTH_CLIENT_SECRET');
    try {
      const url = new URL(origin ?? '');
      if (
        url.origin !== origin ||
        !(
          url.protocol === 'https:' ||
          (url.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
        )
      )
        fields.push('AUTH_PUBLIC_ORIGIN');
    } catch {
      fields.push('AUTH_PUBLIC_ORIGIN');
    }
  }
  const allowedHosts = new Set<string>();
  const allowedOrigins = new Set<string>();
  if (env.MCP_PUBLIC_URL) {
    try {
      const endpoint = new URL(env.MCP_PUBLIC_URL);
      if (
        !['http:', 'https:'].includes(endpoint.protocol) ||
        !endpoint.pathname.endsWith('/mcp') ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash ||
        endpoint.href !== env.MCP_PUBLIC_URL
      )
        throw new Error();
      allowedHosts.add(endpoint.host);
    } catch {
      fields.push('MCP_PUBLIC_URL');
    }
  }
  for (const entry of (env.MCP_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)) {
    try {
      const origin = new URL(entry);
      if (
        !['http:', 'https:'].includes(origin.protocol) ||
        entry !== origin.origin
      )
        throw new Error();
      allowedOrigins.add(entry);
    } catch {
      fields.push('MCP_ALLOWED_ORIGINS');
      break;
    }
  }
  if (fields.length > 0) {
    throw new ConfigurationError(fields);
  }

  return {
    databaseUrl,
    host,
    port,
    nodeEnv: nodeEnv as ApiConfig['nodeEnv'],
    ...(allowedHosts.size || allowedOrigins.size
      ? { mcp: { allowedHosts, allowedOrigins } }
      : {}),
    ...(clientId && clientSecret && origin
      ? { github: { clientId, clientSecret, origin, adminIds } }
      : {}),
  };
}
