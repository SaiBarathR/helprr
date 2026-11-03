import type { ArchivePlatform } from '@prisma/client';

/** Named on every Twitch query, so an id from another platform finds nothing here. */
export const TWITCH: ArchivePlatform = 'TWITCH';
