# The only process that runs yt-dlp, TwitchDownloaderCLI and ffmpeg. Debian rather than
# Alpine because Jellyfin's ffmpeg, which carries its own Intel driver, ships for Debian.
FROM node:24.22.1-bookworm-slim AS base
# Prisma picks its engine from the OpenSSL it finds when generating.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build:twitch-worker

FROM base AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci --omit=dev
RUN npx prisma generate

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ARG APP_VERSION=""
ENV APP_VERSION=$APP_VERSION
# TwitchDownloaderCLI is .NET; without ICU it needs the invariant mode.
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg unzip \
    && curl -fsSL https://repo.jellyfin.org/jellyfin_team.gpg.key | gpg --dearmor -o /usr/share/keyrings/jellyfin.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/jellyfin.gpg] https://repo.jellyfin.org/debian bookworm main" > /etc/apt/sources.list.d/jellyfin.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends jellyfin-ffmpeg8 \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/jellyfin.list

# npm is a build tool, not a runtime requirement.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist/twitch-worker.mjs ./twitch-worker.mjs

RUN mkdir -p /data/tools /media/twitch && chown -R 1000:1000 /data

USER 1000:1000
CMD ["node", "twitch-worker.mjs"]
