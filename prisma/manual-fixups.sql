-- Idempotent pre-push fix-ups. Runs before `prisma db push` in the container
-- entrypoint so schema changes Prisma can't auto-cast (e.g. TEXT → enum
-- conversions with existing rows) succeed without --force-reset.
--
-- Each block must be safe to run repeatedly: guard on pg_type / pg_class /
-- information_schema before applying.

-- ─── CleanupAction enum migration ────────────────────────────────────────
-- Converts CleanupHistory.action from TEXT to the new CleanupAction enum
-- without dropping existing rows. No-op when:
--   • The CleanupHistory table doesn't exist yet (fresh DB; Prisma creates
--     the column with the enum type directly on the subsequent db push).
--   • The action column is already typed as CleanupAction (already migrated).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'CleanupHistory'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'CleanupHistory'
      AND column_name = 'action'
      AND udt_name = 'text'
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CleanupAction') THEN
      CREATE TYPE "CleanupAction" AS ENUM (
        'strikeAdded',
        'removedFromClient',
        'removedFromQueue',
        'categoryChanged',
        'skipped',
        'dryRunPreview',
        'failed'
      );
    END IF;

    ALTER TABLE "CleanupHistory"
      ALTER COLUMN action TYPE "CleanupAction" USING action::"CleanupAction";
  END IF;
END$$;

-- ─── ServiceConnection multi-instance migration ──────────────────────────────
-- The multi-instance feature added ServiceConnection.label (NOT NULL) and
-- isDefault, and replaced the old `type @unique` with @@unique([type, label]).
-- We must backfill BEFORE `prisma db push --accept-data-loss` enforces the
-- NOT NULL column and the composite unique, otherwise existing single-instance
-- connections would be dropped. No-op on a fresh DB (table absent) and safe to
-- run repeatedly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ServiceConnection'
  ) THEN
    ALTER TABLE "ServiceConnection" ADD COLUMN IF NOT EXISTS "label" TEXT;
    ALTER TABLE "ServiceConnection" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;

    -- Rows predating labels: seed from the service type so every (type, label)
    -- pair is unique (single-instance DBs have exactly one row per type).
    UPDATE "ServiceConnection" SET "label" = "type"::text WHERE "label" IS NULL OR "label" = '';

    -- Promote exactly one default per type (oldest row), but only for types that
    -- don't already have one — so a default chosen in-app survives later reboots.
    UPDATE "ServiceConnection" sc SET "isDefault" = true
    WHERE sc.id IN (
      SELECT DISTINCT ON (s."type") s.id
      FROM "ServiceConnection" s
      WHERE NOT EXISTS (
        SELECT 1 FROM "ServiceConnection" d
        WHERE d."type" = s."type" AND d."isDefault" = true
      )
      ORDER BY s."type", s."createdAt" ASC
    );
  END IF;
END$$;

-- ─── PollingState re-key: serviceType → serviceConnectionId ───────────────────
-- The multi-instance feature re-keyed PollingState from `serviceType @unique` to
-- `serviceConnectionId @unique` (FK → ServiceConnection). `db push` can't add the
-- NOT NULL FK column to existing rows, so backfill it from each row's serviceType
-- default connection BEFORE db push. Runs after the ServiceConnection block above
-- so isDefault is already populated. No-op on a fresh DB and safe to run repeatedly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'PollingState'
  ) THEN
    ALTER TABLE "PollingState" ADD COLUMN IF NOT EXISTS "serviceConnectionId" TEXT;

    -- Only backfill while the legacy serviceType column still exists (pre-push).
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'PollingState' AND column_name = 'serviceType'
    ) THEN
      UPDATE "PollingState" ps SET "serviceConnectionId" = (
        SELECT sc.id FROM "ServiceConnection" sc
        WHERE sc."type" = ps."serviceType"
        ORDER BY sc."isDefault" DESC, sc."createdAt" ASC
        LIMIT 1
      )
      WHERE ps."serviceConnectionId" IS NULL;
    END IF;

    -- Orphan state for a service type with no connection: nothing to map it to.
    DELETE FROM "PollingState" WHERE "serviceConnectionId" IS NULL;
  END IF;
END$$;

-- ─── AniListSeriesMapping: add + backfill sonarrInstanceId ────────────────────
-- The multi-instance feature re-keyed AniListSeriesMapping from `sonarrSeriesId
-- @unique` to `@@unique([sonarrInstanceId, sonarrSeriesId])`, adding a NOT NULL
-- sonarrInstanceId column with no default. Backfill it from the default Sonarr
-- connection BEFORE db push so existing mappings survive. No-op on a fresh DB and
-- safe to run repeatedly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'AniListSeriesMapping'
  ) THEN
    ALTER TABLE "AniListSeriesMapping" ADD COLUMN IF NOT EXISTS "sonarrInstanceId" TEXT;

    UPDATE "AniListSeriesMapping" am SET "sonarrInstanceId" = (
      SELECT sc.id FROM "ServiceConnection" sc
      WHERE sc."type" = 'SONARR'
      ORDER BY sc."isDefault" DESC, sc."createdAt" ASC
      LIMIT 1
    )
    WHERE am."sonarrInstanceId" IS NULL;

    -- Orphan mappings with no Sonarr connection at all: nothing to map them to.
    DELETE FROM "AniListSeriesMapping" WHERE "sonarrInstanceId" IS NULL;
  END IF;
END$$;
