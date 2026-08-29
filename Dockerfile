FROM node:24-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci
RUN npx prisma generate

# Production-only dependencies for the runtime image (no devDependencies).
# The Prisma CLI is a production dependency, so it survives --omit=dev and
# stays available for boot-time `migrate deploy`.
FROM base AS prod-deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci --omit=dev
RUN npx prisma generate

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Version identity for Settings → Status (CI passes the image tag + commit SHA;
# defaults keep local builds working — next.config falls back to package.json).
ARG APP_VERSION=""
ARG GIT_SHA=""
ENV APP_VERSION=$APP_VERSION
ENV GIT_SHA=$GIT_SHA

RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Patch the base image's OpenSSL from the Alpine mirror. node:24-alpine lags the
# branch it is built from — it shipped libcrypto3/libssl3 3.5.7-r0 while Alpine
# v3.24 main already carried 3.5.8-r0 (CVE-2026-14456) — and the image-scan gate
# blocks any fixable high, so waiting on an upstream rebuild blocks every merge.
# Targeted rather than a blanket `apk upgrade`, to keep the published image's
# package set predictable. Node links its own bundled OpenSSL, so this changes
# only what the OS-package scanner reads and cannot affect the runtime.
RUN apk upgrade --no-cache libcrypto3 libssl3

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
RUN mkdir -p /app/logs /app/image-cache \
    && chown nextjs:nodejs /app/logs /app/image-cache

# npm/Corepack are build tools, not runtime requirements. Prisma is invoked via
# its project-local executable below, so remove the global package managers from
# the published image to reduce attack surface (including bundled dependencies).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx

COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

# Standalone output + static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./

# Prisma CLI needs node_modules for boot-time migrate deploy. Startup calls the
# local `.bin/prisma` directly; the runtime image intentionally contains no npm.
COPY --from=prod-deps /app/node_modules ./node_modules

USER nextjs

EXPOSE 3050
ENV PORT=3050
ENV HOSTNAME="0.0.0.0"
ENV LOG_DIR=/app/logs
ENV IMAGE_CACHE_DIR=/app/image-cache
# Our shutdown coordinator (src/lib/shutdown.ts) owns SIGTERM/SIGINT and drains
# background work; without this Next.js exits immediately on the first signal.
ENV NEXT_MANUAL_SIG_HANDLE=true

# Migrations run in the entrypoint, which then execs node as PID 1 so it
# receives SIGTERM directly (required for graceful shutdown on updates).
CMD ["./docker-entrypoint.sh"]
