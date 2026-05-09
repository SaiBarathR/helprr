-- Flip the column-level default for failed-body logging to off so new
-- installations are secure by default. Existing rows keep whatever value the
-- administrator already chose; this only changes the default applied when a
-- future row is inserted without these columns specified.
ALTER TABLE "AppSettings"
  ALTER COLUMN "logFailedRequestBodies" SET DEFAULT false,
  ALTER COLUMN "logFailedResponseBodies" SET DEFAULT false;
