-- lastQueueIds becomes nullable with no default: NULL now marks "queue baseline
-- not yet captured" so first-run detection survives pollServiceReachability
-- creating the PollingState row before the first queue poll stores a snapshot.
-- Existing rows keep their '[]' (already-baselined) value.
ALTER TABLE "PollingState" ALTER COLUMN "lastQueueIds" DROP NOT NULL,
ALTER COLUMN "lastQueueIds" DROP DEFAULT;
