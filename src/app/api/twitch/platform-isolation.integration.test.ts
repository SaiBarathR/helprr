import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const url = process.env.TWITCH_QUEUE_TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
const user = { id: 'isolation-user', username: 'isolation', role: 'admin', template: null, permissions: null };

vi.mock('@/lib/db', () => ({ get prisma() { return prisma; } }));
vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ ok: true, user }),
  requireUserCapability: async () => ({ ok: true, user }),
}));

import { GET as getJobs } from './jobs/route';
import { GET as getJob, PATCH as patchJob } from './jobs/[id]/route';
import { POST as cancelJob } from './jobs/[id]/cancel/route';
import { POST as retryJob } from './jobs/[id]/retry/route';
import { GET as getFiles } from './files/route';
import { GET as getSummary } from './files/summary/route';
import { GET as getHistory } from './files/history/route';
import { DELETE as deleteFile, GET as getFile, PATCH as patchFile } from './files/[id]/route';
import { POST as reencodeFile } from './files/[id]/reencode/route';
import { DELETE as deleteOriginal } from './files/[id]/original/route';
import { POST as restoreOriginal } from './files/[id]/original/restore/route';
import { GET as getFeed } from './feed/route';
import { GET as getStreamers } from './streamers/route';
import { GET as getStreamer } from './streamers/[id]/route';
import { GET as getStreamerVideos } from './streamers/[id]/videos/route';
import { DELETE as deleteSubscription, PATCH as patchSubscription } from './subscriptions/[id]/route';
import { GET as getVideo } from './videos/[id]/route';
import { POST as setVideoState } from './videos/[id]/state/route';
import { GET as getPolicies, PUT as putPolicies } from './policies/route';
import { POST as previewPolicies } from './policies/preview/route';
import { DEFAULT_DOWNLOAD_OPTIONS, enqueueDownload } from '@/lib/twitch/jobs';

const SAME = { externalId: 'same-id', folderName: 'same-folder', relativePath: 'same-folder/file.mkv', requestId: 'same-request-id' };

const req = (path: string, body?: unknown) => new NextRequest(`http://test${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

// Needs a migrated, disposable PostgreSQL; skipped without one.
describe.skipIf(!url || !url.endsWith('/helprr_migration_test'))('platform isolation against PostgreSQL', () => {
  const db = prisma!;
  const ids = { twitch: {} as Record<string, string>, youtube: {} as Record<string, string> };

  async function seed(platform: 'TWITCH' | 'YOUTUBE') {
    const creator = await db.creator.create({
      data: { platform, externalId: SAME.externalId, login: 'same', folderName: SAME.folderName, displayName: platform },
    });
    const video = await db.creatorVideo.create({
      data: {
        platform, externalId: SAME.externalId, creatorId: creator.id, type: 'ARCHIVE', title: platform,
        sourceCreatedAt: new Date(), durationSeconds: 60,
      },
    });
    const file = await db.archiveMediaFile.create({
      data: {
        platform, videoId: video.id, relativePath: SAME.relativePath, sizeBytes: BigInt(1), durationSeconds: 60,
        videoCodec: 'h264', originalRelativePath: 'same-folder/original.mkv',
      },
    });
    const job = await db.archiveJob.create({
      data: {
        platform, kind: 'DOWNLOAD', state: 'FAILED', videoId: video.id, requestedByUserId: user.id,
        clientRequestId: SAME.requestId,
      },
    });
    const subscription = await db.creatorSubscription.create({ data: { userId: user.id, creatorId: creator.id } });
    await db.archiveDeletedFile.create({
      data: { platform, title: platform, streamer: platform, kind: 'FILE', cause: 'PERSON', freedBytes: BigInt(7) },
    });
    return { creator: creator.id, video: video.id, file: file.id, job: job.id, subscription: subscription.id };
  }

  async function youtubeRows() {
    const id = ids.youtube;
    return JSON.stringify({
      file: await db.archiveMediaFile.findUniqueOrThrow({ where: { id: id.file }, select: { keepForever: true } }),
      job: await db.archiveJob.findUniqueOrThrow({ where: { id: id.job }, select: { state: true, priority: true, cancelRequested: true } }),
      subscription: await db.creatorSubscription.findUniqueOrThrow({ where: { id: id.subscription }, select: { notifyNewVods: true } }),
      policy: await db.creatorPolicy.count({ where: { creatorId: id.creator } }),
      states: await db.creatorVideoState.count({ where: { videoId: id.video } }),
      jobs: await db.archiveJob.count({ where: { platform: 'YOUTUBE' } }),
    });
  }

  beforeAll(async () => {
    await db.$connect();
  });
  afterAll(async () => {
    await db.archiveJob.deleteMany();
    await db.archiveDeletedFile.deleteMany();
    await db.creator.deleteMany();
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  });
  beforeEach(async () => {
    await db.archiveJob.deleteMany();
    await db.archiveDeletedFile.deleteMany();
    await db.creator.deleteMany();
    await db.user.upsert({
      where: { id: user.id },
      update: {},
      create: { id: user.id, username: user.username, displayName: user.username },
    });
    ids.twitch = await seed('TWITCH');
    ids.youtube = await seed('YOUTUBE');
  });

  it('holds the same ids, folder, path and request id on both platforms', async () => {
    expect(await db.creator.count({ where: { externalId: SAME.externalId, folderName: SAME.folderName } })).toBe(2);
    expect(await db.archiveMediaFile.count({ where: { relativePath: SAME.relativePath } })).toBe(2);
    expect(await db.archiveJob.count({ where: { clientRequestId: SAME.requestId } })).toBe(2);
  });

  it('still refuses a duplicate within one platform', async () => {
    await expect(db.creator.create({
      data: { platform: 'TWITCH', externalId: SAME.externalId, login: 'x', folderName: 'other', displayName: 'X' },
    })).rejects.toThrow();
    await expect(db.creator.create({
      data: { platform: 'TWITCH', externalId: 'other', login: 'x', folderName: SAME.folderName, displayName: 'X' },
    })).rejects.toThrow();
  });

  it('finds the Twitch row through every route that takes an id', async () => {
    const id = ids.twitch;
    expect((await getJob(req('/'), ctx(id.job))).status).toBe(200);
    expect((await getFile(req('/'), ctx(id.file))).status).toBe(200);
    expect((await getStreamer(req('/'), ctx(id.creator))).status).toBe(200);
    expect((await getVideo(req('/'), ctx(id.video))).status).toBe(200);
  });

  it('answers not found for a YouTube id on every Twitch read', async () => {
    const id = ids.youtube;
    expect((await getJob(req('/'), ctx(id.job))).status).toBe(404);
    expect((await getFile(req('/'), ctx(id.file))).status).toBe(404);
    expect((await getStreamer(req('/'), ctx(id.creator))).status).toBe(404);
    expect((await getVideo(req('/'), ctx(id.video))).status).toBe(404);
    expect((await (await getStreamerVideos(req('/x'), ctx(id.creator))).json()).videos).toEqual([]);
    expect((await (await getPolicies(req(`/api/twitch/policies?streamerId=${id.creator}`))).json()).streamer).toBeNull();
    expect((await (await previewPolicies(req('/', { streamerId: id.creator }))).json()).results).toEqual([]);
  });

  it('changes nothing for a YouTube id on every Twitch write', async () => {
    const id = ids.youtube;
    const before = await youtubeRows();
    expect((await patchJob(req('/', { priority: 5 }), ctx(id.job))).status).toBe(404);
    expect((await cancelJob(req('/', {}), ctx(id.job))).status).toBe(404);
    expect((await retryJob(req('/', {}), ctx(id.job))).status).toBe(404);
    expect((await patchFile(req('/', { keepForever: true }), ctx(id.file))).status).toBe(404);
    expect((await deleteFile(req('/', {}), ctx(id.file))).status).toBe(404);
    expect((await reencodeFile(req('/', { when: 'now' }), ctx(id.file))).status).toBe(404);
    expect((await deleteOriginal(req('/', {}), ctx(id.file))).status).toBe(404);
    expect((await restoreOriginal(req('/', {}), ctx(id.file))).status).toBe(404);
    expect((await patchSubscription(req('/', { notifyNewVods: false }), ctx(id.subscription))).status).toBe(404);
    expect((await deleteSubscription(req('/', {}), ctx(id.subscription))).status).toBe(404);
    expect((await setVideoState(req('/', { seen: true }), ctx(id.video))).status).toBe(404);
    expect((await putPolicies(req('/', { streamerId: id.creator, policy: {} }))).status).toBe(404);
    expect(await youtubeRows()).toBe(before);
  });

  it('lists only Twitch rows', async () => {
    const titles = (rows: Array<{ id: string }>) => rows.map((row) => row.id);
    expect(titles((await (await getFeed(req('/api/twitch/feed'))).json()).videos)).toEqual([ids.twitch.video]);
    expect(titles((await (await getFiles(req('/api/twitch/files'))).json()).files)).toEqual([ids.twitch.file]);
    expect(titles((await (await getJobs()).json()).jobs)).toEqual([ids.twitch.job]);
    const { subscriptions } = await (await getStreamers()).json() as { subscriptions: Array<{ id: string }> };
    expect(titles(subscriptions)).toEqual([ids.twitch.subscription]);
    const summary = await (await getSummary()).json() as { totalFiles?: number; count?: number };
    expect(summary.totalFiles ?? summary.count).toBe(1);
    const history = await (await getHistory(req('/api/twitch/files/history'))).json() as { deletions: Array<{ title: string }> };
    expect(history.deletions.map((row) => row.title)).toEqual(['TWITCH']);
    expect(history.deletions[0]).not.toHaveProperty('platform');
  });

  it('keeps a repeated request id to its own platform', async () => {
    const { jobId, created } = await enqueueDownload({
      videoId: ids.twitch.video,
      source: 'MANUAL',
      options: DEFAULT_DOWNLOAD_OPTIONS,
      actor: { id: user.id, username: user.username },
      clientRequestId: SAME.requestId,
    });
    expect(jobId).toBe(ids.twitch.job);
    expect(created).toBe(false);
  });
});
