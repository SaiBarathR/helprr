DELETE FROM "ServiceConnection"
WHERE "type" = 'JELLYFIN';

DELETE FROM "PollingState"
WHERE "serviceType" = 'JELLYFIN';
