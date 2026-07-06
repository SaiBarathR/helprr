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

# NEXT_PUBLIC_ vars must be available at build time
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY

RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
RUN mkdir -p /app/logs && chown nextjs:nodejs /app/logs

COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

# Standalone output + static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma CLI needs node_modules for boot-time migrate deploy
COPY --from=prod-deps /app/node_modules ./node_modules

USER nextjs

EXPOSE 3050
ENV PORT=3050
ENV HOSTNAME="0.0.0.0"
ENV LOG_DIR=/app/logs

# Apply pending migrations, then start. Fails loudly (and blocks boot) if a
# migration cannot be applied. Databases created before the migration-based
# workflow must be baselined once:
#   npx prisma migrate resolve --applied 0001_init
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
