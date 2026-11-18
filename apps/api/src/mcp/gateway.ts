import type { AuthContext } from '@agorafab/domain';
import {
  createAgoraMcpServer,
  WebStandardStreamableHTTPServerTransport,
  type McpActions,
} from '@agorafab/mcp';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { IdentityService } from '../auth/identity.js';

interface GatewayOptions {
  identity: IdentityService;
  actions: (auth: AuthContext | null) => McpActions;
  allowedHosts?: ReadonlySet<string>;
  allowedOrigins?: ReadonlySet<string>;
}

const sdkRequestHeaders = [
  'accept',
  'content-type',
  'mcp-protocol-version',
  'mcp-session-id',
];
const sdkResponseHeaders = [
  'content-type',
  'mcp-protocol-version',
  'mcp-session-id',
];

function loopbackHost(host: string) {
  const match =
    /^(?:localhost|127\.0\.0\.1|\[::1\])(?::([1-9][0-9]{0,4}))?$/.exec(host);
  return !!match && (!match[1] || Number(match[1]) <= 65_535);
}

function protocolError(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
) {
  return reply.code(status).send({
    jsonrpc: '2.0',
    id: null,
    error: {
      code: status === 405 ? -32601 : status >= 500 ? -32603 : -32600,
      message,
      data: { code, requestId: request.id },
    },
  });
}

export function registerMcpGateway(
  app: FastifyInstance,
  options: GatewayOptions,
) {
  const allowedHosts = new Set(
    Array.from(options.allowedHosts ?? [], (host) => host.toLowerCase()),
  );
  app.route({
    method: ['POST', 'GET', 'DELETE'],
    url: '/mcp',
    exposeHeadRoute: false,
    onRequest: async (request, reply) => {
      reply.header('cache-control', 'no-store');
      reply.header('x-content-type-options', 'nosniff');
      // Use the actual Host header and exact allowed origins. Forwarded headers
      // are client input unless a trusted proxy validates them first.
      const host = request.headers.host?.toLowerCase();
      if (!host || (!loopbackHost(host) && !allowedHosts.has(host))) {
        return protocolError(
          request,
          reply,
          403,
          'INVALID_HOST',
          'Host is not allowed.',
        );
      }
      const origin = request.headers.origin;
      if (origin !== undefined && !options.allowedOrigins?.has(origin)) {
        return protocolError(
          request,
          reply,
          403,
          'INVALID_ORIGIN',
          'Origin is not allowed.',
        );
      }
      if (request.method !== 'POST') {
        reply.header('allow', 'POST');
        return protocolError(
          request,
          reply,
          405,
          'METHOD_NOT_ALLOWED',
          'Send MCP messages using POST.',
        );
      }
    },
    async handler(request, reply) {
      let auth: AuthContext | null = null;
      // The absent header means anonymous access even when a session cookie is sent.
      if (request.headers.authorization !== undefined) {
        auth = await options.identity.authenticate(request);
        if (auth?.method !== 'bearer') {
          reply.header('www-authenticate', 'Bearer realm="AgoraFab"');
          return protocolError(
            request,
            reply,
            401,
            'UNAUTHORIZED',
            'A valid Agent credential is required.',
          );
        }
      }
      if (Array.isArray(request.body)) {
        return protocolError(
          request,
          reply,
          400,
          'INVALID_REQUEST',
          'Send one MCP message per request.',
        );
      }

      const headers = new Headers();
      for (const name of sdkRequestHeaders) {
        const value = request.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }
      const sdkRequest = new Request('http://localhost/mcp', {
        method: 'POST',
        headers,
      });
      const transport = new WebStandardStreamableHTTPServerTransport({
        enableJsonResponse: true,
      });
      const server = createAgoraMcpServer(
        options.actions(auth),
        request.id,
        (code) => request.log.error({ code }, 'MCP tool failed.'),
      );
      try {
        await server.connect(transport);
        const response = await transport.handleRequest(sdkRequest, {
          parsedBody: request.body,
        });
        reply.code(response.status);
        for (const name of sdkResponseHeaders) {
          const value = response.headers.get(name);
          if (value) reply.header(name, value);
        }
        return response.body
          ? reply.send(Buffer.from(await response.arrayBuffer()))
          : reply.send();
      } finally {
        await server.close();
      }
    },
  });
}
