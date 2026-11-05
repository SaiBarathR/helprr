---
title: Contributing
description: Run Helprr from source beside a real install, and the commands you will use.
---

## Isolated development stack

Maintainers and contributors can run development beside stable on the same
Docker host. The standalone development Compose file uses its own containers,
network, database, Redis, volumes, secrets, and ports:

| Component | Stable | Development |
|---|---|---|
| Application | `helprr` on `3050` | `helprr-dev` on `3051` |
| PostgreSQL | `helprr-db` | `helprr-dev-db`, loopback port `5433` |
| Redis | `helprr-redis` | `helprr-dev-redis`, loopback port `6380` |
| Database | `helprr` | `helprr_dev` |
| Image cache | `helprr-image-cache` | `helprr-dev-image-cache` |
| Other volumes/network | Stable names | Dedicated `helprr-dev-*` names |

Generate the development-only env file. The helper refuses to overwrite an existing
`.env.dev`; do not copy the production database, Redis, JWT, or VAPID secrets:

```bash
./scripts/setup-env.sh --dev
nano .env.dev
```

Build the current checkout in the isolated stack:

```bash
HELPRR_DEV_GIT_SHA="$(git rev-parse --short HEAD)" \
  docker compose --env-file .env.dev -f docker-compose.dev.yml \
  up -d --build
```

Open `http://YOUR_SERVER:3051`. The stable installation on port `3050` remains
running and its database is never mounted or addressed by the development stack.

To exercise the image published from `development`, set this in `.env.dev`:

```dotenv
HELPRR_DEV_IMAGE=ghcr.io/saibarathr/helprr:edge
```

Before testing a migration or replacing the development image, create a backup of
only the isolated development database. Development and stable dumps are written to
separate private directories. Then pull and replace only the development app:

```bash
./scripts/backup.sh --dev
docker compose --env-file .env.dev -f docker-compose.dev.yml pull helprr-dev
docker compose --env-file .env.dev -f docker-compose.dev.yml \
  up -d --no-build --no-deps helprr-dev
curl -fsS http://localhost:3051/api/health
curl -fsS http://localhost:3051/api/ready
```

The app replacement must not restart `helprr-dev-db` or `helprr-dev-redis`. Readiness
must report the development database, Redis, and migrations as `ok`.

See [Maintainer development and release workflow](https://github.com/SaiBarathR/helprr/blob/main/docs/maintainer-development-release-workflow.md)
for the complete feature, `edge`, release, promotion, rollback, and hotfix process.

## Local development

Use Node.js **24** to match the Docker image, plus the isolated development stack's PostgreSQL and Redis services. The stable Compose file publishes no database or Redis port to the host, and local development must not share stable data.

1. Generate the development Compose configuration and start only its data services. Compose reads `.env.dev` here, not `.env.local`.
  ```bash
   ./scripts/setup-env.sh --dev
   docker compose --env-file .env.dev -f docker-compose.dev.yml up -d helprr-dev-db helprr-dev-redis
  ```
2. Create `.env.local` for the Node process. Use the loopback ports the development stack publishes—not Compose service names—with the two passwords generated in `.env.dev`, and URL-encode the PostgreSQL password if needed.
  ```dotenv
   DATABASE_URL=postgresql://postgres:YOUR_ENCODED_HELPRR_DEV_POSTGRES_PASSWORD@localhost:5433/helprr_dev
   REDIS_URL=redis://localhost:6380
   REDIS_PASSWORD=YOUR_HELPRR_DEV_REDIS_PASSWORD
   APP_PASSWORD=YOUR_BOOTSTRAP_ADMIN_PASSWORD
   JWT_SECRET=YOUR_32_OR_MORE_CHARACTER_SECRET
   TZ=Etc/UTC
  ```
3. Install dependencies, initialize Prisma, and run the app.
  ```bash
   npm ci
   npm run db:generate
   npm run db:deploy
   npm run dev
  ```

`db:deploy` and `db:migrate` explicitly load `.env.local` and stop if that file is
missing; Prisma otherwise auto-loads `.env`, which may describe a different Compose
stack. `.env.dev` is only the isolated Compose interpolation file and intentionally
does not contain `DATABASE_URL`. Open [http://localhost:3050](http://localhost:3050).
Use `npm run db:migrate` only when you are authoring a new Prisma migration; it is not
the normal first-run command.

## Database migrations

Prisma migrations are the database source of truth.

- For normal deployment and first setup, use `npm run db:deploy`; the Docker entrypoint runs the same `prisma migrate deploy` command automatically before starting Next.js.
- When changing `prisma/schema.prisma` during development, run `npm run db:migrate` and commit the generated migration directory.
- Never edit or remove a migration after it has shipped in a release. Add a new migration instead.
- Patch releases must not contain destructive schema changes. Changes that drop or rewrite user data require explicit migration and rollback guidance in a minor or major release.

## Useful commands

```bash
# App
npm run dev
npm run build
npm run lint
npm test

# Image-cache qualification (the Redis command creates and removes a disposable container)
npm run test:image-cache:redis
# Deterministic local upstream and libuv/Sharp runtime measurement
npm run image-cache:harness-upstream
npm run image-cache:measure-runtime
# Authenticated isolated-dev load run; configure HELPRR_IMAGE_HARNESS_* first
npm run test:image-cache:cold-grid

# Prisma
npm run db:generate
npm run db:deploy
npm run db:migrate

# Docker (published image)
docker compose pull
docker compose up -d
docker compose logs -f helprr
docker compose down

# Docker (isolated development stack built from source)
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build

# Docker (published edge image; set HELPRR_DEV_IMAGE=...:edge in .env.dev first)
docker compose --env-file .env.dev -f docker-compose.dev.yml pull helprr-dev
docker compose --env-file .env.dev -f docker-compose.dev.yml \
  up -d --no-build --no-deps helprr-dev
```
