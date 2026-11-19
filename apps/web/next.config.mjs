/** @type {import('next').NextConfig} */
const config = {
  agentRules: false,
  poweredByHeader: false,
  // OAuth callback URLs carry a one-use authorization code and state.
  logging: { incomingRequests: { ignore: [/^\/api\/auth(?:\/|$)/] } },
  experimental: { cpus: 2 },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        source: '/api/auth/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default config;
