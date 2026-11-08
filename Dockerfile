# deps -> build -> runtime (Node). Bun is only the package manager.

ARG BUN_IMAGE=oven/bun:1.4.4
FROM ${BUN_IMAGE} AS bun
FROM node:24-slim AS deps
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /usr/src/app
# ca-certificates: sentry-cli needs them to reach the Sentry API over HTTPS at build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# production dependencies only, for the runtime image
FROM node:24-slim AS prod-deps
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /usr/src/app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

FROM deps AS build
WORKDIR /usr/src/app

ARG VERSION
ARG COMMIT_SHA
ARG NEXT_PUBLIC_SENTRY_DSN
ARG SENTRY_ORG
ARG SENTRY_PROJECT

COPY . .

# baked into the bundles. VERSION arrives already v-stripped from the
# workflow (it reuses the tag it computes for the image), so plain ENV works.
# CI=true un-silences sentry.
ENV NEXT_PUBLIC_APP_VERSION=${VERSION:-latest}
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA:-localbuild}
ENV SENTRY_RELEASE=${VERSION:-latest}
ENV NEXT_PUBLIC_SENTRY_RELEASE=${VERSION:-latest}
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true

# token only exists inside this RUN (secret mount, never baked into a layer)
RUN --mount=type=cache,target=/usr/src/app/.next/cache \
    --mount=type=secret,id=SENTRY_AUTH_TOKEN \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/SENTRY_AUTH_TOKEN 2>/dev/null)" \
    node node_modules/next/dist/bin/next build

# optional local hot-reload: docker build --target dev (bind-mount source)
FROM deps AS dev
WORKDIR /usr/src/app
ENV NODE_ENV=development
EXPOSE 3000
CMD ["bun", "dev"]

FROM node:24-slim AS runtime
WORKDIR /usr/src/app

ARG VERSION
ARG NEXT_PUBLIC_SENTRY_DSN

ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# the scripts (migrations, make-admin, guest purge) run outside the Next bundle, so they read these at run time
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_RELEASE=${VERSION:-latest}

COPY --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY package.json next.config.ts statut.json ./
COPY --from=build /usr/src/app/.next ./.next
COPY public ./public
COPY messages ./messages
COPY assets ./assets
COPY drizzle ./drizzle
COPY scripts ./scripts

# non-root; migrations run on start, then Next serves on :3000
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://localhost:3000/api/auth/ok').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["sh", "scripts/docker-entrypoint.sh"]
