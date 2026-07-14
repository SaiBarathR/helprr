-- The daily retention sweep removes sessions once their fixed-lifetime JWT
-- can no longer authenticate. Keep that bounded delete index-backed.
CREATE INDEX "Session_createdAt_idx" ON "Session"("createdAt");
