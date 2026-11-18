import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import type { Database } from '@agorafab/db';
import { DomainError } from '@agorafab/domain';
import {
  registerGitHubRoutes,
  type GitHubConfig,
  type GitHubProvider,
} from './auth/github.js';
import { createIdentityService } from './auth/identity.js';
import { registerIdentityRoutes } from './auth/routes.js';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';

export interface BuildAppOptions {
  checkDatabase: () => Promise<void>;
  logger?: boolean;
  logStream?: Writable;
  database?: Database;
  github?: GitHubConfig;
  githubProvider?: GitHubProvider;
}

function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  code: string,
  message: string,
) {
  return reply
    .code(status)
    .send({ error: { code, message, requestId: request.id } });
}

/** All future REST and MCP adapters must share authorization-checked domain services. */
export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    bodyLimit: 64 * 1024,
    logger:
      options.logger === false
        ? false
        : {
            level: 'info',
            ...(options.logStream ? { stream: options.logStream } : {}),
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
              ],
              censor: '[REDACTED]',
            },
            // Keep raw headers, URLs, query values, payloads and dependency errors out of logs.
            serializers: {
              req: (request: FastifyRequest) => ({ method: request.method }),
              res: (reply: { statusCode: number }) => ({
                statusCode: reply.statusCode,
              }),
              err: () => ({
                type: 'Error',
                message: 'Error details omitted.',
                stack: '',
              }),
            },
          },
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('cache-control', 'no-store');
  });

  app.setNotFoundHandler((request, reply) =>
    sendError(reply, request, 404, 'NOT_FOUND', 'Route not found.'),
  );

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof DomainError) {
      return sendError(
        reply,
        request,
        error.statusCode,
        error.code,
        error.message,
      );
    }
    if (error.validation || error.statusCode === 400) {
      return sendError(
        reply,
        request,
        400,
        'VALIDATION_ERROR',
        'Invalid request.',
      );
    }
    if (error.statusCode === 413) {
      return sendError(
        reply,
        request,
        413,
        'PAYLOAD_TOO_LARGE',
        'Request body is too large.',
      );
    }
    if (error.statusCode === 415) {
      return sendError(
        reply,
        request,
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Unsupported content type.',
      );
    }
    request.log.error({ code: 'INTERNAL_ERROR' }, 'Request failed.');
    return sendError(
      reply,
      request,
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred.',
    );
  });

  if (options.database) {
    registerGitHubRoutes(app, {
      database: options.database,
      config: options.github,
      provider: options.githubProvider,
    });
    registerIdentityRoutes(
      app,
      createIdentityService(options.database, options.github),
      options.github?.origin,
    );
  }

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (request, reply) => {
    try {
      await options.checkDatabase();
      return { status: 'ok' };
    } catch {
      request.log.warn(
        { code: 'DEPENDENCY_UNAVAILABLE' },
        'Readiness check failed.',
      );
      return sendError(
        reply,
        request,
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Service is not ready.',
      );
    }
  });

  return app;
}
