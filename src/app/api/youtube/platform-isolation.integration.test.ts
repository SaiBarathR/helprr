import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env.TWITCH_QUEUE_TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
const user = { id: 'youtube-isolation-user', username: 'isolation', role: 'admin', template: null, permissions: null };

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
import { DELETE as deleteFile, GET as getFile, PATCH as patchFile } from './files/[id]/route';
import { GET as getVideo } from './videos/[id]/route';
import { POST as setVideoState } from './videos/[id]/state/route';
import { GET as getChannel } from './channels/[id]/route';
import { POST as syncChannel } from './channels/[id]/sync/route';
import { GET as getChannelVideos } from './channels/[id]/videos/route';
import { DEFAULT_DOWNLOAD_OPTIONS, enqueueDownload } from '@/lib/archive/jobs';

const req = (path: string, body?: unknown) => new NextRequest(`http://test${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

// Needs a migrated, disposable PostgreSQL; skipped without one.
describe.skipIf(!url || !url.endsWith('/helprr_migration_test'))('a Twitch row seen from the YouTube routes', () => {
  const db = prisma!;
  const ids = { channel: '', video: '', file: '', job: '', youtubeJob: '', youtubeFile: '' };

  async function seed(platform: 'TWITCH' | 'YOUTUBE') {
    const channel = await db.creator.create({ data: { platform, externalId: `iso-${platform}`, login: 'iso', folderName: 'iso', displayName: platform } });
    const video = await db.creatorVideo.create({
      data: { platform, externalId: `iso-${platform}`, creatorId: channel.id, type: 'UPLOAD', title: platform, sourceCreatedAt: new Date(), durationSeconds: 60 },
    });
    const file = await db.archiveMediaFile.create({
      data: { platform, videoId: video.id, relativePath: 'iso/file.mkv', sizeBytes: BigInt(1), durationSeconds: 60, videoCodec: 'h264', height: 1080 },
    });
    const { jobId } = await enqueueDownload({ platform, videoId: video.id, source: 'MANUAL', options: DEFAULT_DOWNLOAD_OPTIONS });
    return { channel: channel.id, video: video.id, file: file.id, job: jobId };
  }

  beforeAll(async () => {
    await db.archiveJob.deleteMany();
    await db.archiveMediaFile.deleteMany();
    await db.creator.deleteMany();
    await db.user.upsert({ where: { id: user.id }, update: {}, create: { id: user.id, username: user.username, displayName: 'Isolation' } });
    Object.assign(ids, await seed('TWITCH'));
    const youtube = await seed('YOUTUBE');
    ids.youtubeJob = youtube.job;
    ids.youtubeFile = youtube.file;
  });
  afterAll(async () => {
    await db.archiveJob.deleteMany();
    await db.archiveMediaFile.deleteMany();
    await db.creator.deleteMany();
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  });

  it('lists only YouTube jobs and files', async () => {
    const jobs = await (await getJobs()).json();
    expect(jobs.jobs.map((job: { id: string }) => job.id)).toEqual([ids.youtubeJob]);
    const files = await (await getFiles(req('/api/youtube/files'))).json();
    expect(files.files.map((file: { id: string }) => file.id)).toEqual([ids.youtubeFile]);
  });

  it.each([
    ['a job', () => getJob(req('/x'), ctx(ids.job))],
    ['a file', () => getFile(req('/x'), ctx(ids.file))],
    ['a video', () => getVideo(req('/x'), ctx(ids.video))],
    ['a channel', () => getChannel(req('/x'), ctx(ids.channel))],
  ])('does not read %s', async (_label, read) => {
    expect((await read()).status).toBe(404);
  });

  it.each([
    ['cancel a job', () => cancelJob(req('/x', {}), ctx(ids.job))],
    ['retry a job', () => retryJob(req('/x', {}), ctx(ids.job))],
    ['reprioritise a job', () => patchJob(new NextRequest('http://test/x', { method: 'PATCH', body: JSON.stringify({ priority: 5 }) }), ctx(ids.job))],
    ['change a file', () => patchFile(new NextRequest('http://test/x', { method: 'PATCH', body: JSON.stringify({ keepForever: true }) }), ctx(ids.file))],
    ['delete a file', () => deleteFile(new NextRequest('http://test/x', { method: 'DELETE', body: JSON.stringify({ confirm: true }) }), ctx(ids.file))],
    ['mark a video seen', () => setVideoState(req('/x', { seen: true }), ctx(ids.video))],
    ['sweep a channel', () => syncChannel(req('/x', {}), ctx(ids.channel))],
  ])('cannot %s', async (_label, act) => {
    expect((await act()).status).toBe(404);
  });

  it('shows no Twitch videos under a Twitch channel id', async () => {
    const { videos } = await (await getChannelVideos(req('/x'), ctx(ids.channel))).json();
    expect(videos).toEqual([]);
  });

  it('left the Twitch rows as they were', async () => {
    expect(await db.archiveMediaFile.findUniqueOrThrow({ where: { id: ids.file } })).toMatchObject({ keepForever: false });
    expect((await db.archiveJob.findUniqueOrThrow({ where: { id: ids.job } })).state).toBe('QUEUED');
    expect(await db.creatorVideoState.count({ where: { videoId: ids.video } })).toBe(0);
  });
});
