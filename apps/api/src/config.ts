import { isIP } from 'node:net';

export interface ApiConfig {
  databaseUrl: string;
  host: string;
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
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
  if (fields.length > 0) {
    throw new ConfigurationError(fields);
  }

  return { databaseUrl, host, port, nodeEnv: nodeEnv as ApiConfig['nodeEnv'] };
}
