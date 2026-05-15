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
