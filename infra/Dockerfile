ARG NODE_IMAGE=node:22.22.1-bookworm-slim
FROM ${NODE_IMAGE} AS base
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
RUN pnpm install --frozen-lockfile
COPY . .

FROM base AS api
RUN pnpm --filter @agorafab/api build
USER node
EXPOSE 3001
CMD ["pnpm", "--filter", "@agorafab/api", "start"]

FROM base AS migrate
USER node
CMD ["pnpm", "db:migrate"]

FROM base AS web
RUN pnpm --filter @agorafab/web build
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@agorafab/web", "start"]
