-- Additive only. Alone in its migration: PostgreSQL cannot use a new enum value in the
-- transaction that adds it.
ALTER TYPE "ServiceType" ADD VALUE 'TWITCH';
