-- A file's real picture size: height alone cannot name a 2:1 or a portrait video.
ALTER TABLE "TwitchMediaFile" ADD COLUMN "width" INTEGER;

-- What the worker found for a job and is really fetching.
ALTER TABLE "TwitchJob" ADD COLUMN "chosenFormat" TEXT;

-- The stored lists changed shape. They are only a cache: the worker reads them again on request.
UPDATE "TwitchVideo" SET "formats" = NULL, "formatsCheckedAt" = NULL WHERE "formats" IS NOT NULL;
