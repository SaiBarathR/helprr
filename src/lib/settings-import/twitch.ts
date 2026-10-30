// Twitch section of a settings import: settings, rules and subscriptions. Jobs,
// videos and files are not settings, and the first sweep rebuilds the videos silently.

import type { Prisma } from '@prisma/client';
import type { ExportedTwitch } from '@/lib/settings-export';
import { layerMap, sanitizeLayer } from '@/lib/twitch/policy';
import { parseTwitchLogin } from '@/lib/twitch/streamers';

const json = (value: unknown) => value as Prisma.InputJsonValue;
const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};
const time = (value: unknown, fallback: string) =>
  (typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback);

export async function applyTwitchInTxn(
  tx: Prisma.TransactionClient,
  data: ExportedTwitch,
  importerId: string,
  skipped: string[],
): Promise<number> {
  const s = data.settings ?? {};
  const settings = {
    autoDownloadEnabled: s.autoDownloadEnabled === true,
    defaultPolicy: json(sanitizeLayer(s.defaultPolicy)),
    typePolicies: json(layerMap(s.typePolicies)),
    jellyfinLibraryPath: typeof s.jellyfinLibraryPath === 'string' ? s.jellyfinLibraryPath : null,
    maxConcurrentDownloads: clamp(s.maxConcurrentDownloads, 1, 6, 2),
    minFreeGb: clamp(s.minFreeGb, 1, 10_000, 50),
    reencodeEnabled: s.reencodeEnabled !== false,
    reencodeGlobalQuality: clamp(s.reencodeGlobalQuality, 1, 51, 20),
    reencodeWindowStart: time(s.reencodeWindowStart, '01:00'),
    reencodeWindowEnd: time(s.reencodeWindowEnd, '08:00'),
    keepOriginalDays: clamp(s.keepOriginalDays, 0, 365, 3),
    // Only the encrypted form: it is unreadable under another JWT_SECRET, and that just reads as no token.
    ...(typeof data.browserAuthToken === 'string' && data.browserAuthToken.startsWith('enc:v1:')
      ? { browserAuthToken: data.browserAuthToken }
      : {}),
  };
  await tx.twitchSettings.upsert({ where: { id: 'singleton' }, update: settings, create: { id: 'singleton', ...settings } });

  let imported = 0;
  for (const entry of Array.isArray(data.subscriptions) ? data.subscriptions : []) {
    // The login names a folder on disk, so it is held to Twitch's own format.
    const login = typeof entry?.login === 'string' ? parseTwitchLogin(entry.login) : null;
    if (!login || typeof entry.twitchUserId !== 'string' || !/^\d{1,20}$/.test(entry.twitchUserId)) {
      skipped.push('Twitch: subscription with an invalid channel');
      continue;
    }
    const streamer = await tx.twitchStreamer.upsert({
      where: { twitchUserId: entry.twitchUserId },
      update: {},
      create: {
        twitchUserId: entry.twitchUserId,
        login,
        folderName: login,
        displayName: typeof entry.displayName === 'string' ? entry.displayName.slice(0, 100) : login,
      },
    });
    await tx.twitchSubscription.upsert({
      where: { userId_streamerId: { userId: importerId, streamerId: streamer.id } },
      update: { notifyNewVods: entry.notifyNewVods !== false },
      create: { userId: importerId, streamerId: streamer.id, notifyNewVods: entry.notifyNewVods !== false },
    });
    if (entry.policy || entry.typePolicies) {
      const policy = { policy: json(sanitizeLayer(entry.policy)), typePolicies: json(layerMap(entry.typePolicies)) };
      await tx.twitchStreamerPolicy.upsert({ where: { streamerId: streamer.id }, update: policy, create: { streamerId: streamer.id, ...policy } });
    }
    imported += 1;
  }
  return imported;
}
