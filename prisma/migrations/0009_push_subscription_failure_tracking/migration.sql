-- Track consecutive push failures per subscription so dead endpoints whose
-- errors carry no statusCode (network errors, timeouts) can still be pruned
-- after a threshold instead of accumulating forever.
ALTER TABLE "PushSubscription"
  ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastFailedAt" TIMESTAMP(3),
  ADD COLUMN "lastSucceededAt" TIMESTAMP(3);
