import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const url = process.env.TWITCH_QUEUE_TEST_DATABASE_URL;

const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
vi.mock('@/lib/db', () => ({ get prisma() { return prisma; } }));

import { enqueueDownload, DEFAULT_DOWNLOAD_OPTIONS, DEFAULT_YOUTUBE_OPTIONS, retryJob } from '@/lib/archive/jobs';
import { REENCODE_NOW_PRIORITY } from '@/lib/archive/reencode-window';
import { claimJob } from './claim';

// Needs a migrated, disposable PostgreSQL; skipped without one.
describe.skipIf(!url || !url.endsWith('/helprr_migration_test'))('Twitch queue against PostgreSQL', () => {
  const db = prisma!;
  let videoId: string;

  beforeAll(async () => {
    await db.$connect();
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    await db.creator.deleteMany();
    await db.archiveJob.deleteMany();
    const streamer = await db.creator.create({
      data: { externalId: '1', login: 'a', folderName: 'a', displayName: 'A' },
    });
    const video = await db.creatorVideo.create({
      data: { externalId: '1', creatorId: streamer.id, type: 'ARCHIVE', title: 'T', sourceCreatedAt: new Date(), durationSeconds: 60 },
    });
    videoId = video.id;
  });

  const request = (overrides = {}) => ({ platform: 'TWITCH' as const, videoId, source: 'MANUAL' as const, options: DEFAULT_DOWNLOAD_OPTIONS, ...overrides });

  it('claims each platform it is told is ready, and leaves a paused one queued', async () => {
    const { jobId } = await enqueueDownload(request());
    const youtube = await db.archiveJob.create({ data: { platform: 'YOUTUBE', kind: 'DOWNLOAD', videoId } });

    expect((await claimJob(db, 'worker', ['DOWNLOAD'], ['TWITCH']))?.id).toBe(jobId);
    expect(await claimJob(db, 'worker', ['DOWNLOAD'], ['TWITCH'])).toBeNull();
    expect((await claimJob(db, 'worker', ['DOWNLOAD'], ['TWITCH', 'YOUTUBE']))?.id).toBe(youtube.id);
  });

  it('claims nothing when no platform is ready', async () => {
    await enqueueDownload(request());
    expect(await claimJob(db, 'worker', ['DOWNLOAD'], [])).toBeNull();
  });

  it('finishes a cancelled job only for its own platforms', async () => {
    const dead = { kind: 'DOWNLOAD' as const, videoId, state: 'RUNNING' as const, cancelRequested: true, leaseUntil: new Date(0) };
    const youtube = await db.archiveJob.create({ data: { platform: 'YOUTUBE', ...dead } });

    await claimJob(db, 'worker', ['DOWNLOAD'], ['TWITCH']);

    expect((await db.archiveJob.findUniqueOrThrow({ where: { id: youtube.id } })).state).toBe('RUNNING');
  });

  it('leaves a job from another platform alone', async () => {
    await db.archiveJob.create({ data: { platform: 'YOUTUBE', kind: 'DOWNLOAD', videoId } });
    expect(await claimJob(db, 'worker', ['DOWNLOAD'], ['TWITCH'])).toBeNull();
  });

  it('leaves one active job after two racing enqueues', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => enqueueDownload(request())));

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.jobId)).size).toBe(1);
    expect(await db.archiveJob.count()).toBe(1);
  });

  it('returns the existing job for a repeated client request, even after it finished', async () => {
    const user = await db.user.create({ data: { username: `u${Date.now()}`, displayName: 'U', passwordHash: 'x' } });
    const actor = { id: user.id, username: user.username };
    const first = await enqueueDownload(request({ actor, clientRequestId: 'repeat-0001' }));
    await db.archiveJob.update({ where: { id: first.jobId }, data: { state: 'DONE' } });

    const second = await enqueueDownload(request({ actor, clientRequestId: 'repeat-0001' }));

    expect(second).toEqual({ jobId: first.jobId, created: false });
    await db.archiveJob.deleteMany();
    await db.user.delete({ where: { id: user.id } });
  });

  it('allows a new download once the last one has finished', async () => {
    const first = await enqueueDownload(request());
    await db.archiveJob.update({ where: { id: first.jobId }, data: { state: 'FAILED' } });
    expect((await enqueueDownload(request())).created).toBe(true);
  });

  it('gives a job to exactly one of many claimers', async () => {
    await enqueueDownload(request());

    const claims = await Promise.all(Array.from({ length: 8 }, (_, index) => claimJob(db, `w${index}`, ['DOWNLOAD'], ['TWITCH'])));

    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('takes over an expired lease and leaves a live one alone', async () => {
    const { jobId } = await enqueueDownload(request());
    await claimJob(db, 'first', ['DOWNLOAD'], ['TWITCH']);
    expect(await claimJob(db, 'second', ['DOWNLOAD'], ['TWITCH'])).toBeNull();

    await db.archiveJob.update({ where: { id: jobId }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    const taken = await claimJob(db, 'second', ['DOWNLOAD'], ['TWITCH']);

    expect(taken?.leaseOwner).toBe('second');
    expect(taken?.attempts).toBe(2);
  });

  it('runs higher priority first and honours runAfter', async () => {
    const low = await enqueueDownload(request());
    const video = await db.creatorVideo.create({
      data: { externalId: '2', creatorId: (await db.creator.findFirstOrThrow()).id, type: 'ARCHIVE', title: 'U', sourceCreatedAt: new Date(), durationSeconds: 60 },
    });
    const high = await enqueueDownload(request({ videoId: video.id, priority: 10 }));

    await db.archiveJob.update({ where: { id: high.jobId }, data: { runAfter: new Date(Date.now() + 60_000) } });
    expect((await claimJob(db, 'w', ['DOWNLOAD'], ['TWITCH']))?.id).toBe(low.jobId);
    await db.archiveJob.update({ where: { id: high.jobId }, data: { runAfter: new Date() } });
    expect((await claimJob(db, 'w', ['DOWNLOAD'], ['TWITCH']))?.id).toBe(high.jobId);
  });

  it('leaves a night re-encode waiting while claiming one asked for now', async () => {
    const night = await db.archiveJob.create({ data: { kind: 'REENCODE', videoId } });
    const urgent = await db.archiveJob.create({ data: { kind: 'REENCODE', videoId, priority: REENCODE_NOW_PRIORITY } });

    expect((await claimJob(db, 'worker', ['REENCODE'], ['TWITCH'], REENCODE_NOW_PRIORITY))?.id).toBe(urgent.id);
    expect(await claimJob(db, 'worker', ['REENCODE'], ['TWITCH'], REENCODE_NOW_PRIORITY)).toBeNull();
    expect((await claimJob(db, 'worker', ['REENCODE'], ['TWITCH']))?.id).toBe(night.id);
  });

  it('ends a cancelled job whose worker died, and frees its video', async () => {
    const { jobId } = await enqueueDownload(request());
    await claimJob(db, 'dead', ['DOWNLOAD'], ['TWITCH']);
    await db.archiveJob.update({ where: { id: jobId }, data: { cancelRequested: true, leaseUntil: new Date(Date.now() - 1000) } });

    expect(await claimJob(db, 'next', ['DOWNLOAD'], ['TWITCH'])).toBeNull();

    expect((await db.archiveJob.findUniqueOrThrow({ where: { id: jobId } })).state).toBe('CANCELLED');
    expect((await enqueueDownload(request())).created).toBe(true);
  });

  it('resumes a disk-blocked job once its recheck is due, and not before', async () => {
    const { jobId } = await enqueueDownload(request());
    await db.archiveJob.update({ where: { id: jobId }, data: { state: 'BLOCKED', runAfter: new Date(Date.now() + 60_000) } });
    expect(await claimJob(db, 'w', ['DOWNLOAD'], ['TWITCH'])).toBeNull();

    await db.archiveJob.update({ where: { id: jobId }, data: { runAfter: new Date(Date.now() - 1000) } });
    expect((await claimJob(db, 'w', ['DOWNLOAD'], ['TWITCH']))?.id).toBe(jobId);
  });

  it('refuses a retry that would make a second active download, even racing', async () => {
    const user = await db.user.create({ data: { username: `r${Date.now()}`, displayName: 'R', passwordHash: 'x' } });
    const actor = { id: user.id, username: user.username };
    const failedA = await enqueueDownload(request());
    await db.archiveJob.update({ where: { id: failedA.jobId }, data: { state: 'FAILED' } });
    const replacement = await enqueueDownload(request());

    expect(await retryJob(failedA.jobId, actor, 'TWITCH')).toBe('active');

    await db.archiveJob.update({ where: { id: replacement.jobId }, data: { state: 'FAILED' } });
    const results = await Promise.all([retryJob(failedA.jobId, actor, 'TWITCH'), retryJob(replacement.jobId, actor, 'TWITCH')]);

    expect(results.filter((result) => result === 'retried')).toHaveLength(1);
    expect(await db.archiveJob.count({ where: { state: 'QUEUED' } })).toBe(1);
    await db.archiveJob.deleteMany();
    await db.user.delete({ where: { id: user.id } });
  });

  it('records who retried a job', async () => {
    const user = await db.user.create({ data: { username: `s${Date.now()}`, displayName: 'S', passwordHash: 'x' } });
    const { jobId } = await enqueueDownload(request());
    await db.archiveJob.update({ where: { id: jobId }, data: { state: 'CANCELLED', cancelRequested: true } });

    expect(await retryJob(jobId, { id: user.id, username: user.username }, 'TWITCH')).toBe('retried');

    expect(await db.archiveJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({
      state: 'QUEUED', cancelRequested: false, requestedByUsername: user.username,
    });
    await db.archiveJob.deleteMany();
    await db.user.delete({ where: { id: user.id } });
  });

  it('skips a job marked for cancellation and other job kinds', async () => {
    const { jobId } = await enqueueDownload(request());
    expect(await claimJob(db, 'w', ['REENCODE'], ['TWITCH'])).toBeNull();
    await db.archiveJob.update({ where: { id: jobId }, data: { cancelRequested: true } });
    expect(await claimJob(db, 'w', ['DOWNLOAD'], ['TWITCH'])).toBeNull();
  });

  describe('a person starting a YouTube rule download that is waiting', () => {
    const chosen = { ...DEFAULT_YOUTUBE_OPTIONS, quality: '2160' };
    let youtubeVideoId: string;
    let user: { id: string; username: string };
    const ruleJob = (data: object = {}) => db.archiveJob.create({
      data: {
        platform: 'YOUTUBE', kind: 'DOWNLOAD', videoId: youtubeVideoId, source: 'RULE',
        runAfter: new Date(Date.now() + 3 * 3_600_000), options: { ...DEFAULT_YOUTUBE_OPTIONS }, ...data,
      },
    });
    const ask = (clientRequestId = 'request-0001') => enqueueDownload({
      platform: 'YOUTUBE', videoId: youtubeVideoId, source: 'MANUAL', options: chosen,
      actor: user, clientRequestId, startWaitingRuleJob: true,
    });

    beforeEach(async () => {
      const channel = await db.creator.create({
        data: { platform: 'YOUTUBE', externalId: 'yt', login: 'yt', folderName: 'yt', displayName: 'YT' },
      });
      const video = await db.creatorVideo.create({
        data: { platform: 'YOUTUBE', externalId: 'yt', creatorId: channel.id, type: 'UPLOAD', title: 'T', sourceCreatedAt: new Date(), durationSeconds: 60 },
      });
      youtubeVideoId = video.id;
      const row = await db.user.create({ data: { username: `y${Date.now()}`, displayName: 'Y', passwordHash: 'x' } });
      user = { id: row.id, username: row.username };
    });
    afterAll(async () => {
      await db.archiveJob.deleteMany();
      await db.user.deleteMany({ where: { displayName: 'Y' } });
    });

    it('hands the worker that same job at once, with their choices', async () => {
      const job = await ruleJob();
      await expect(ask()).resolves.toEqual({ jobId: job.id, created: false, startedNow: true });

      const claimed = await claimJob(db, 'w', ['DOWNLOAD'], ['YOUTUBE']);
      expect(claimed).toMatchObject({ id: job.id, source: 'MANUAL', requestedByUserId: user.id, clientRequestId: 'request-0001' });
      expect(claimed?.options).toMatchObject({ quality: '2160' });
      expect(await db.archiveJob.count()).toBe(1);
    });

    it('leaves a job the worker has already taken, and says it did not start one', async () => {
      const job = await ruleJob({ runAfter: new Date(Date.now() - 1_000) });
      expect((await claimJob(db, 'w', ['DOWNLOAD'], ['YOUTUBE']))?.id).toBe(job.id);

      await expect(ask()).resolves.toEqual({ jobId: job.id, created: false });
      expect(await db.archiveJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ source: 'RULE', options: DEFAULT_YOUTUBE_OPTIONS });
    });

    it('leaves a job being cancelled', async () => {
      const job = await ruleJob({ cancelRequested: true });
      await expect(ask()).resolves.toEqual({ jobId: job.id, created: false });
      expect((await db.archiveJob.findUniqueOrThrow({ where: { id: job.id } })).source).toBe('RULE');
    });

    it('answers a repeated request with the same job and changes nothing more', async () => {
      const job = await ruleJob();
      await ask();
      await expect(ask()).resolves.toEqual({ jobId: job.id, created: false });
      expect(await db.archiveJob.count()).toBe(1);
    });
  });
});
