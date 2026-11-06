// YouTube section of a settings import: settings, rules, and channel and playlist
// follows. Videos, jobs and files are not settings: the first sweep of each channel
// and playlist is a silent baseline, as when it is followed by hand. The spare
// account's cookies and the cleanup viewer are never in an export.

import type { Prisma } from '@prisma/client';
import type { ExportedYoutube } from '@/lib/settings-export';
import { layerMap, sanitizeLayer } from '@/lib/archive/policy';
import { channelFolderBase } from '@/lib/youtube/channels';
import { invalidateQueuedCleanupInTxn } from '@/lib/youtube/cleanup';
import { isChannelId, isPlaylistId } from '@/lib/youtube/ids';
import { YOUTUBE } from '@/lib/youtube/platform';

const json = (value: unknown) => value as Prisma.InputJsonValue;
const HANDLE = /^[A-Za-z0-9._-]{3,30}$/;
// What channelFolderBase can make, with or without its collision suffix: one safe path segment.
const FOLDER = /^[a-z0-9_][a-z0-9._-]{0,63}$/;

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};

// The same rule as linking the library by hand (src/lib/archive/library-route.ts).
const libraryPath = (value: unknown) =>
  (typeof value === 'string' && value.length <= 1024 && value.startsWith('/') && !value.includes('..') ? value : null);

/** The exported folder when it is safe and free, else the one following by hand would pick. */
async function freeFolder(tx: Prisma.TransactionClient, channelId: string, login: string, exported: unknown) {
  const base = channelFolderBase({ id: channelId, handle: login === channelId ? null : login });
  const candidates = [
    ...(typeof exported === 'string' && FOLDER.test(exported) && !exported.endsWith('.') ? [exported] : []),
    base,
    `${base}-${channelId.slice(-6).toLowerCase()}`,
  ];
  for (const folderName of candidates) {
    const taken = await tx.creator.findUnique({
      where: { platform_folderName: { platform: YOUTUBE, folderName } },
      select: { id: true },
    });
    if (!taken) return folderName;
  }
  return null;
}

export async function applyYoutubeInTxn(
  tx: Prisma.TransactionClient,
  data: ExportedYoutube,
  importerId: string,
  skipped: string[],
): Promise<{ subscriptions: number; playlists: number }> {
  // Absent when the source had no YouTube set up: that must not reset this install's.
  const s = data.settings;
  if (s && typeof s === 'object' && !Array.isArray(s)) {
    const settings = {
      autoDownloadEnabled: s.autoDownloadEnabled === true,
      defaultPolicy: json(sanitizeLayer(s.defaultPolicy)),
      typePolicies: json(layerMap(s.typePolicies)),
      jellyfinLibraryPath: libraryPath(s.jellyfinLibraryPath),
      pollVideosSecs: clamp(s.pollVideosSecs, 300, 86_400, 600),
    };
    const current = await tx.youtubeSettings.findUnique({ where: { id: 'singleton' }, select: { jellyfinLibraryPath: true } });
    // The library id belongs to the old path; linking the library again finds the new one.
    const libraryItem = current?.jellyfinLibraryPath === settings.jellyfinLibraryPath ? {} : { jellyfinLibraryItemId: null };
    await tx.youtubeSettings.upsert({
      where: { id: 'singleton' },
      update: { ...settings, ...libraryItem },
      create: { id: 'singleton', ...settings },
    });
  }

  let subscriptions = 0;
  for (const entry of Array.isArray(data.subscriptions) ? data.subscriptions : []) {
    const channelId = typeof entry?.channelId === 'string' && isChannelId(entry.channelId) ? entry.channelId : null;
    if (!channelId) {
      skipped.push('YouTube: subscription with an invalid channel');
      continue;
    }
    const login = typeof entry.login === 'string' && HANDLE.test(entry.login) ? entry.login : channelId;
    const key = { platform_externalId: { platform: YOUTUBE, externalId: channelId } };
    const existing = await tx.creator.findUnique({
      where: key,
      select: { id: true, _count: { select: { subscriptions: true } } },
    });
    let creatorId: string;
    if (existing) {
      creatorId = existing.id;
      // Unwatched for a while: what was published meanwhile is history, not news (subscribeToCreator).
      if (existing._count.subscriptions === 0) {
        await tx.creator.update({ where: { id: creatorId }, data: { baselinedAt: null, nextVideosCheckAt: null } });
        await tx.creatorVideo.updateMany({
          where: { creatorId, notifiedAt: null, availability: 'PUBLISHED' },
          data: { notifiedAt: new Date() },
        });
      }
    } else {
      const folderName = await freeFolder(tx, channelId, login, entry.folderName);
      if (!folderName) {
        skipped.push('YouTube: subscription whose library folder is taken');
        continue;
      }
      const created = await tx.creator.create({
        data: {
          platform: YOUTUBE,
          externalId: channelId,
          login,
          folderName,
          displayName: typeof entry.displayName === 'string' && entry.displayName ? entry.displayName.slice(0, 100) : login,
        },
        select: { id: true },
      });
      creatorId = created.id;
    }
    const notifyNewVods = entry.notifyNewVods !== false;
    await tx.creatorSubscription.upsert({
      where: { userId_creatorId: { userId: importerId, creatorId } },
      update: { notifyNewVods },
      create: { userId: importerId, creatorId, notifyNewVods },
    });
    if (entry.policy || entry.typePolicies) {
      const policy = { policy: json(sanitizeLayer(entry.policy)), typePolicies: json(layerMap(entry.typePolicies)) };
      await tx.creatorPolicy.upsert({ where: { creatorId }, update: policy, create: { creatorId, ...policy } });
    }
    subscriptions += 1;
  }

  let playlists = 0;
  for (const entry of Array.isArray(data.playlists) ? data.playlists : []) {
    const playlistId = typeof entry?.playlistId === 'string' && isPlaylistId(entry.playlistId) ? entry.playlistId : null;
    if (!playlistId) {
      skipped.push('YouTube: playlist with an invalid id');
      continue;
    }
    const key = { platform_externalId: { platform: YOUTUBE, externalId: playlistId } };
    const existing = await tx.creatorPlaylist.findUnique({
      where: key,
      select: { _count: { select: { subscriptions: true } } },
    });
    // The first sweep refills the details; a list nobody watched takes a new silent baseline (followPlaylist).
    const playlist = await tx.creatorPlaylist.upsert({
      where: key,
      update: existing?._count.subscriptions === 0 ? { baselinedAt: null, nextCheckAt: null } : {},
      create: {
        platform: YOUTUBE,
        externalId: playlistId,
        title: typeof entry.title === 'string' && entry.title ? entry.title.slice(0, 200) : playlistId,
      },
      select: { id: true },
    });
    const notifyNewVideos = entry.notifyNewVideos !== false;
    await tx.creatorPlaylistSubscription.upsert({
      where: { userId_playlistId: { userId: importerId, playlistId: playlist.id } },
      update: { notifyNewVideos },
      create: { userId: importerId, playlistId: playlist.id, notifyNewVideos },
    });
    playlists += 1;
  }

  // The rules may have changed, so a cleanup delete queued under the old ones must not run.
  await invalidateQueuedCleanupInTxn(tx);
  return { subscriptions, playlists };
}
