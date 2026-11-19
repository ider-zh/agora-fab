import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/bootstrap-admin.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  noExternal: ['@agorafab/db', '@agorafab/domain', '@agorafab/mcp'],
  // The bundled pg dependency uses Node built-ins through CommonJS require.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  clean: true,
});
