ARG NODE_IMAGE=node:22.22.1-bookworm-slim
FROM ${NODE_IMAGE} AS manifests
ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/pnpm/corepack
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/mcp/package.json packages/mcp/package.json

FROM manifests AS build
RUN pnpm install --frozen-lockfile
COPY . .

FROM build AS api-build
RUN pnpm --filter @agorafab/api build

FROM build AS web-build
RUN pnpm --filter @agorafab/web build

FROM manifests AS runtime
RUN pnpm install --prod --frozen-lockfile
ENV NODE_ENV=production

FROM runtime AS api
COPY --from=api-build /app/apps/api/dist apps/api/dist
USER node
EXPOSE 3001
CMD ["pnpm", "--filter", "@agorafab/api", "start"]

FROM runtime AS migrate
COPY packages/db/src packages/db/src
COPY packages/db/migrations packages/db/migrations
USER node
CMD ["pnpm", "db:migrate"]

FROM runtime AS web
COPY --from=web-build /app/apps/web/.next apps/web/.next
COPY apps/web/next.config.mjs apps/web/next.config.mjs
COPY scripts/run-web.mjs scripts/run-web.mjs
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@agorafab/web", "start"]
