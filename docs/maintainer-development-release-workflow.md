# Maintainer development and release workflow

This guide is for the Helprr maintainer. It describes how to develop a feature,
publish the development image, qualify a release, and promote the tested image to
the stable channel.

The central rule is:

> GitHub Actions builds and publishes Helprr images. Deployment hosts pull and run
> those images. Do not manually build the production image from the `main` branch.

## The three environments

| Environment | Source | Image | Data |
|---|---|---|---|
| Local feature work | A `feat/*` or `fix/*` branch | Local source through `npm run dev` or a local Docker build | Development database |
| Development deployment | A feature checkout or `development` | Local `helprr-dev:local` build or `ghcr.io/saibarathr/helprr:edge` | Dedicated `helprr_dev` database |
| Stable production | A version tag on `main` | Exact version such as `1.1.0`, later promoted to `stable` | Production database |

Never connect an `edge` deployment to the production PostgreSQL database. A
development image may apply a migration that the currently deployed stable image
cannot reverse.

The development and production environments should also have separate:

- PostgreSQL and Redis volumes.
- `.env` files and secrets.
- VAPID key pairs and push subscriptions.
- Ports, hostnames, and reverse-proxy routes.
- User accounts where practical.
- Arr service test instances, or at minimum cleanup and destructive actions disabled.

Helprr provides a standalone [docker-compose.dev.yml](../docker-compose.dev.yml) and
[.env.dev.example](../.env.dev.example) for this isolation. It can run on the same
Docker host as stable because it uses `helprr-dev`, `helprr-dev-db`, and
`helprr-dev-redis`; app port `3051`; loopback database/Redis ports `5433`/`6380`; and
dedicated `helprr-dev-*` volumes and network. Always pass `--env-file .env.dev` and
`-f docker-compose.dev.yml` together when operating it.

## Branches and image tags

### Branch purpose

- `main` is the default branch and represents stable, released source code.
- `development` contains changes intended for the next release.
- `feat/<name>` contains one new feature.
- `fix/<name>` contains one bug fix.
- `chore/<name>` contains maintenance, documentation, CI, or release work.

Prefer a short-lived branch and PR into `development` instead of pushing unfinished
work directly to `development`. Every push to `development` starts native amd64 and
arm64 image builds.

### Image tag purpose

- `edge` is mutable. Every successful Docker publication from `development` replaces
  it.
- `1.0.1`, `1.1.0`, and similar tags are exact release images. Never overwrite or
  reuse an exact version tag.
- `1.0`, `1.1`, and `1` are release-channel aliases maintained by promotion.
- `stable` is mutable, but only the manual promotion workflow moves it.
- Helprr intentionally does not publish a `latest` tag.

Changing a registry tag does not restart anyone's container. Users receive a newer
image only after running `docker compose pull` and `docker compose up -d`, or through
an external updater they configured themselves.

## What the GitHub workflows do

| Workflow | Trigger | Result |
|---|---|---|
| [CI](../.github/workflows/ci.yml) | Any PR; pushes to `development` or `main` | Installs dependencies, generates Prisma, lints, tests, validates the schema, and builds |
| [Docker publish](../.github/workflows/docker-publish.yml) | Push to `development` | Builds and scans native amd64/arm64 images, then updates `edge` |
| Docker publish | Push of a `vX.Y.Z` tag | Builds exact `X.Y.Z` image and creates a draft GitHub release with deployment assets |
| [Docker promote](../.github/workflows/docker-promote.yml) | Manual workflow dispatch | Verifies a qualified digest, then moves minor, major, and `stable` aliases to it |

A push to `main` runs CI but does **not** publish an image. A version tag is required
to publish an exact release image.

On a push to `development`, CI and Docker publish are separate workflows. Treat the
new `edge` image as deployable only after both workflows are green. The preferred PR
flow ensures the exact commit has already passed CI before it reaches `development`.

## End-to-end flow

```mermaid
flowchart LR
    A["Feature branch"] --> B["PR into development"]
    B --> C["development"]
    C --> D["GitHub builds edge"]
    D --> E["Development deployment"]
    E --> F["Manual verification"]
    F --> G["Prepare release version"]
    G --> H["PR development to main"]
    H --> I["Tag vX.Y.Z"]
    I --> J["GitHub builds exact X.Y.Z image"]
    J --> K["Deploy exact image to production"]
    K --> L["Production smoke test"]
    L --> M["Promote tested digest"]
    M --> N["stable"]
```

## Part 1: develop a feature

### 1. Start from the latest development branch

```bash
git switch development
git pull --ff-only origin development
git status
```

Do not begin with uncommitted changes. Create a branch with a focused name:

```bash
git switch -c feat/my-new-feature
```

For a bug fix:

```bash
git switch -c fix/short-bug-description
```

### 2. Implement and test locally

For the fastest application-development loop, use the existing local environment:

```bash
npm ci
npm run dev
```

For a full local source-based container build, initialize the isolated development
configuration once:

```bash
./scripts/setup-env.sh --dev
# Review the generated development-only values and optional settings.
nano .env.dev

HELPRR_DEV_GIT_SHA="$(git rev-parse --short HEAD)" \
  docker compose --env-file .env.dev -f docker-compose.dev.yml \
  up -d --build
```

This is a complete stack, not an override layered over the stable file. It builds the
current checkout as `helprr-dev:local` and can run beside stable without sharing its
containers or data. Open the source build on port `3051`.

If `prisma/schema.prisma` changes, create and review a migration:

```bash
npm run db:migrate
```

Host-side `db:migrate` and `db:deploy` explicitly read `.env.local`; confirm its
`DATABASE_URL` names the intended development database before running either command.
Do not source `.env.dev` for Prisma: it is a Compose interpolation file and has no
`DATABASE_URL`, so a raw Prisma command could otherwise fall through to a stale `.env`.
The isolated Docker app applies migrations internally against `helprr-dev-db`.

Commit the generated `prisma/migrations/<migration-name>/` directory. Never edit or
delete a migration that has appeared in a published release.

### 3. Run the local gate

At minimum:

```bash
npm run lint
npm test
npm run build
```

CI also starts a disposable PostgreSQL 16 database and runs
`npm run test:migrations`. The migration runner reconstructs every recorded release
snapshot, seeds representative rows, applies the current migrations, and checks both
data preservation and the new schema. For a local run, point
`MIGRATION_TEST_DATABASE_URL` at a disposable database named exactly
`helprr_migration_test`; the script refuses every other database name and clears the
scratch schema afterward. Never point it at `helprr`, `helprr_dev`, or any database
containing data you intend to keep.

For database or release-sensitive changes, also run:

```bash
npx prisma validate
docker compose config --quiet
npm audit --omit=dev --audit-level=high
```

Manually verify the affected UI and API flows. For permission-sensitive work, test an
admin and a restricted member account.

### 4. Commit and push the feature branch

Review exactly what will be committed:

```bash
git status
git diff
git diff --cached
```

Then stage, commit, and push:

```bash
git add <changed-files>
git commit -m "feat: add my new feature"
git push -u origin feat/my-new-feature
```

Open a PR from `feat/my-new-feature` into `development`:

```bash
gh pr create \
  --base development \
  --head feat/my-new-feature \
  --title "feat: add my new feature" \
  --body "Summary, verification, and any migration or deployment notes."
```

Wait for CI and review feedback. Do not merge a red PR.

### 5. Merge into development

After approval and green checks, merge the feature PR into `development`. This push
starts two workflows:

1. CI checks the merged commit.
2. Docker publish builds native amd64/arm64 images, blocks fixable high/critical
   vulnerabilities with Trivy, and updates `edge` only after both platform scans pass.

Watch both workflows in the GitHub Actions page, or inspect them with:

```bash
gh run list --branch development --limit 10
```

Do not deploy the new `edge` image if either workflow failed.

## Part 2: deploy and test the development image

The development Compose file supports two modes with the same isolated data.

### Mode A: test the current local source

Leave this value in `.env.dev`:

```dotenv
HELPRR_DEV_IMAGE=helprr-dev:local
```

Build and replace the local development app:

```bash
HELPRR_DEV_GIT_SHA="$(git rev-parse --short HEAD)" \
  docker compose --env-file .env.dev -f docker-compose.dev.yml \
  up -d --build
```

### Mode B: test the published development image

After the `development` CI and Docker workflows pass, set:

```dotenv
HELPRR_DEV_IMAGE=ghcr.io/saibarathr/helprr:edge
```

Pull and replace only the isolated development app:

```bash
./scripts/backup.sh --dev
docker compose --env-file .env.dev -f docker-compose.dev.yml pull helprr-dev
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --no-build
```

The helper selects only `helprr-dev-db`, validates the archive, and stores it separately
from stable backups. Do not continue to the pull if backup creation fails.

The same `helprr_dev` database is retained when switching between the local source and
published `edge` modes. It is never the stable `helprr` database.

### Inspect the development stack

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml ps
docker compose --env-file .env.dev -f docker-compose.dev.yml logs --tail=200 helprr-dev
curl -fsS http://localhost:3051/api/health
```

The expected side-by-side layout is:

- Stable app: `http://localhost:3050`.
- Development app: `http://localhost:3051`.
- Development PostgreSQL: `127.0.0.1:5433` only.
- Development Redis: `127.0.0.1:6380` only.

The database and Redis ports are exposed only on loopback for local debugging tools;
they are not reachable from the LAN.

To stop development without touching stable:

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml down
```

To permanently erase development data only:

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml down -v
```

Never run the `down -v` command against the normal stable Compose file.

Then check:

- Settings → Status shows `development` plus the expected commit SHA in both modes.
  For published-image testing, `docker compose ... ps` or `docker inspect helprr-dev`
  should identify `ghcr.io/saibarathr/helprr:edge` as the image.
- Login works for admin and member accounts.
- Database migrations completed without errors.
- Redis, polling, and cleanup jobs started normally.
- The new feature works on desktop and relevant PWA devices.
- Push notifications still work if the change touches the service worker,
  subscriptions, polling, or notification delivery.
- No unexpected destructive operation occurs against connected services.
- Settings → Service status shows the expected Helprr version/update state, and an
  admin can download a support bundle whose JSON contains no configured credentials.
- The configured upstream versions still match, or deliberately update, the exact
  point versions in [Upstream compatibility](upstream-compatibility.md). Re-test the
  affected feature before changing a row; never infer an inclusive range from two
  successful versions.

If a problem is found, create another focused branch from the latest `development`,
fix it, and repeat the PR process. Do not release until the complete contents of
`development` are acceptable for stable users.

## Part 3: decide the release version

Use semantic versioning:

- Patch `1.0.1`: backward-compatible bug fixes only.
- Minor `1.1.0`: backward-compatible features or substantial improvements.
- Major `2.0.0`: intentional breaking changes or incompatible migration behavior.
- Release candidate `1.1.0-rc.1`: optional qualification build before a large release.

Do not create a new stable release for every commit. Multiple completed features and
fixes can remain on `development` and `edge` until the next planned release.

## Part 4: prepare the release on development

The examples below use `1.1.0`. Replace it with the real version.

Make sure all intended work is present and no unfinished work is included:

```bash
git switch development
git pull --ff-only origin development
git status
git log --oneline origin/main..development
```

Update `package.json` and `package-lock.json` without creating the Git tag yet:

```bash
npm version 1.1.0 --no-git-tag-version
```

Update `CHANGELOG.md` with the release date and user-facing changes. Also verify:

- `README.md` documents new configuration or behavior.
- `docs/upstream-compatibility.md` records any newly qualified upstream version and
  distinguishes a connection probe from real feature-flow evidence.
- `.env.example` includes new runtime variables without secrets.
- `docker-compose.yml` passes any required runtime variables.
- New Prisma migrations are committed and non-destructive for a patch release.
- The displayed application version will be `1.1.0`.

Run the complete release gate:

```bash
npm run lint
npm test
npm run build
npx prisma validate
docker compose config --quiet
npm audit --omit=dev --audit-level=high
```

Commit and push the release preparation:

```bash
git add package.json package-lock.json CHANGELOG.md README.md .env.example docker-compose.yml
git add prisma/migrations 2>/dev/null || true
git commit -m "chore(release): prepare Helprr 1.1.0"
git push origin development
```

Only stage files that actually belong to the release. The explicit list above is a
review prompt, not a requirement to commit unchanged files.

## Part 5: move the qualified source to main

Open a release PR from `development` into `main`:

```bash
gh pr create \
  --base main \
  --head development \
  --title "Release Helprr 1.1.0" \
  --body "Release gate results, migration notes, manual tests, and planned production smoke checks."
```

Wait for every PR check to pass. Review the complete diff from `main`—not only the
last feature commit.

### Preferred fast-forward method

Helprr currently keeps `main` and `development` at the same commit after a release.
After the release PR is reviewed and green:

```bash
git switch development
git pull --ff-only origin development
git fetch origin
git merge-base --is-ancestor origin/main development
git push origin development:main
```

`git merge-base --is-ancestor` prints nothing when successful. If it returns a nonzero
exit status, stop: `main` and `development` have diverged and must be reconciled before
release.

The fast-forward push advances `main` to the exact tested development commit. GitHub
then recognizes the open release PR as merged. Confirm:

```bash
git fetch origin
git rev-parse origin/main
git rev-parse origin/development
gh pr view --json state,mergedAt,url
```

The two commit hashes should match.

If a release PR is instead squash-merged or rebased through the GitHub UI, `main` and
`development` will have different histories. Merge `main` back into `development`
before beginning new work so development contains every stable commit.

Wait for the CI run triggered by the `main` update. Do not create the release tag while
that CI run is failing or still in progress.

## Part 6: tag and build the exact release image

Update the local main branch:

```bash
git switch main
git pull --ff-only origin main
```

Confirm the version and commit:

```bash
node -p "require('./package.json').version"
git log -1 --oneline
git status
```

Create an annotated tag and push it:

```bash
git tag -a v1.1.0 -m "Helprr 1.1.0"
git push origin v1.1.0
```

Never move or reuse a published release tag. If a mistake is discovered after
publication, fix it in a new version such as `1.1.1`.

The version-tag push causes Docker publish to:

1. Build the exact commit natively for amd64 and arm64.
2. Create the multi-architecture `ghcr.io/saibarathr/helprr:1.1.0` manifest.
3. Create a draft GitHub release.
4. Attach `docker-compose.yml`, `env.example`, `setup-env.sh`, and `backup.sh` from
   that exact tag. These are the complete no-clone install and backup assets.

At this point `stable` still points to the previous qualified release.

Wait for Docker publish to finish successfully. Obtain the exact manifest digest:

```bash
DIGEST=$(docker buildx imagetools inspect \
  ghcr.io/saibarathr/helprr:1.1.0 \
  | awk '/^Digest:/ {print $2; exit}')
echo "$DIGEST"
```

Record this digest in the release notes or release checklist.

## Part 7: qualify the exact image in production

Do not qualify `stable`, because it still refers to the old release. Pin production to
the new exact version first.

### 1. Take a protected PostgreSQL backup

From the production Compose directory:

```bash
./scripts/backup.sh
```

The helper creates a transactionally consistent custom-format dump while Helprr stays
online, validates the archive with `pg_restore --list`, publishes it atomically under
`backups/stable/`, and applies directory/file permissions `0700`/`0600`. It does not
stop, restart, update, or migrate any container. Stop qualification if it fails.

Keep the resulting backup until the release has been stable long enough for your risk
tolerance. Database dumps contain API keys and password hashes and must be treated as
secrets. Archive validation is not a substitute for periodic isolated restore tests.

### 2. Pin the exact version

Set this in the production `.env`:

```dotenv
HELPRR_VERSION=1.1.0
```

### 3. Pull and replace the application

```bash
docker compose pull helprr
docker compose up -d
docker compose ps
docker compose logs --tail=250 helprr
```

The image entrypoint applies committed Prisma migrations before starting Next.js.

### 4. Run the production smoke checklist

Verify at minimum:

```bash
curl -fsS http://localhost:3050/api/health
docker compose ps
docker compose logs --tail=250 helprr
```

Also verify:

- Settings → Status displays `1.1.0` and the tagged commit SHA.
- Existing users, service connections, preferences, and history remain present.
- Admin and restricted-member login work.
- Sonarr, Radarr, Lidarr, qBittorrent, Prowlarr, Jellyfin, and other configured services
  still connect as applicable.
- Polling and cleanup schedulers start normally.
- Existing push subscriptions receive a test notification.
- The new feature and its most important failure path work.
- Any affected delete action is permission-checked and audited.
- Container stop/replacement drains background work normally when relevant.

Do not proceed to promotion if any result is uncertain.

### Rollback rule

If no new migration was applied, pin the previous exact version and recreate the app
container.

If the new release applied a migration and the previous version is not compatible,
stop the application and restore the matching pre-upgrade PostgreSQL backup. Do not
attempt an unsupported downgrade across migrations. See [README.md](../README.md) for
the complete restore procedure.

## Part 8: promote the tested digest to stable

Once the exact image has passed production verification, run the manual promotion
workflow:

```bash
gh workflow run docker-promote.yml \
  --ref main \
  -f version=1.1.0 \
  -f source_digest="$DIGEST"
```

Watch it in GitHub Actions. The workflow first verifies that the `1.1.0` tag resolves
to the supplied digest. It then moves these aliases to that exact manifest:

- `1.1`
- `1`
- `stable`

It does not rebuild the image during promotion.

Verify the aliases manually if desired:

```bash
for tag in 1.1.0 1.1 1 stable; do
  docker buildx imagetools inspect \
    "ghcr.io/saibarathr/helprr:$tag" \
    | awk -v tag="$tag" '/^Digest:/ {print tag, $2; exit}'
done
```

Every printed digest must match `$DIGEST`.

## Part 9: publish the GitHub release

The tag workflow creates a draft release. Before publishing it:

1. Give it a clear title such as `Helprr 1.1.0`.
2. Summarize user-visible features and fixes.
3. Call out configuration changes and migrations.
4. Include update and backup guidance.
5. Confirm `docker-compose.yml`, `env.example`, `setup-env.sh`, and `backup.sh` are
   attached and downloadable.
6. Include the qualified multi-arch digest.
7. Mark a stable release as the latest release, not as a prerelease.

Publish through the GitHub Releases UI, or use `gh release edit` after preparing the
notes. Verify the public release page and all four asset downloads after publication.

## Part 10: close the release

Confirm:

```bash
git fetch origin --tags
git rev-parse origin/main
git rev-parse origin/development
git rev-parse 'v1.1.0^{}'
gh release view v1.1.0
gh run list --limit 10
```

The normal completed state is:

- `main` and `development` contain the release commit.
- `v1.1.0` points to the intended release source commit.
- CI and Docker publish are green.
- The exact version and stable aliases resolve to the qualified digest.
- The production deployment remains pinned to the exact version used for the smoke
  test.
- The GitHub release is public and has matching deployment assets.

Leaving the maintainer production instance pinned to the exact version is recommended.
End users who omit `HELPRR_VERSION` follow `stable` on their next pull.

## Emergency patch workflow

For a production bug that cannot wait for the next feature release:

1. Branch from `main`, not from unreleased `development`.
2. Implement only the fix and regression tests.
3. Bump the patch version, for example `1.0.0` → `1.0.1`.
4. Update `CHANGELOG.md`.
5. Open a PR into `main` and require the full release gate.
6. Tag `v1.0.1`, build the exact image, back up production, deploy it, and smoke-test.
7. Promote its digest to `1.0`, `1`, and `stable` through Docker promote.
8. Publish the patch release.
9. Merge the completed `main` hotfix back into `development` so the fix is not lost
   from the next feature release.

Example start:

```bash
git switch main
git pull --ff-only origin main
git switch -c fix/production-problem
npm version 1.0.1 --no-git-tag-version
```

Do not merge all unreleased development features into an emergency patch.

## Common mistakes and what they mean

### "I merged into main, but no new stable image appeared"

This is expected. A `main` push runs CI only. Push a version tag to build an exact
release, qualify that image, and then run Docker promote.

### "I pushed to development, but my development server still runs old code"

Wait for Docker publish to finish, then run:

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml pull helprr-dev
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --no-build
```

Confirm `.env.dev` contains
`HELPRR_DEV_IMAGE=ghcr.io/saibarathr/helprr:edge` and check Settings → Status.

### "Stable was promoted, but users are still on the old version"

Promotion updates the registry alias only. Existing containers do not change until
users pull and recreate them.

### "My exact version does not update after a new stable release"

This is correct. A deployment pinned to `HELPRR_VERSION=1.0.0` remains on `1.0.0` until
the owner changes that value.

### "My development stack collides with production"

Use `docker-compose.dev.yml` by itself with `--env-file .env.dev`; do not layer it over
`docker-compose.yml`. Confirm the development containers and volumes all start with
`helprr-dev`. If stable container names appear in the rendered config, stop before
running it.

### "The old image will not start after testing edge"

The edge image may have applied a newer migration. Do not point edge at production
data. Restore a matching backup instead of attempting an unsupported downgrade.

### "A release tag contains the wrong code"

Do not move a published tag. Fix the source, bump to the next patch version, and publish
a new release.

## Short feature checklist

- [ ] Branch created from current `development`.
- [ ] Feature implemented without unrelated changes.
- [ ] Migration created and reviewed if the schema changed.
- [ ] Lint, tests, and production build pass.
- [ ] Affected admin/member and mobile/PWA flows verified.
- [ ] Feature PR merged into `development`.
- [ ] Development CI and Docker publish are green.
- [ ] `edge` deployed against isolated development data.
- [ ] Settings → Status shows the expected commit.
- [ ] Manual feature and regression tests pass.

## Short stable-release checklist

- [ ] All contents of `development` are intended for release.
- [ ] Correct patch/minor/major version selected.
- [ ] Package version, lockfile, changelog, docs, env, Compose, and migrations reviewed.
- [ ] Full release gate passes.
- [ ] Release PR into `main` is reviewed and green.
- [ ] `main` and `development` are synchronized.
- [ ] Annotated `vX.Y.Z` tag points to the intended commit.
- [ ] Exact multi-arch image build succeeds.
- [ ] Qualified manifest digest recorded.
- [ ] Protected production backup created.
- [ ] Exact version deployed and production smoke test passes.
- [ ] Tested digest promoted to minor, major, and `stable` aliases.
- [ ] Draft GitHub release reviewed and published with both deployment assets.
- [ ] Public release page, image aliases, and workflows verified.
