import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const url = process.env.TWITCH_QUEUE_TEST_DATABASE_URL;

const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
vi.mock('@/lib/db', () => ({ get prisma() { return prisma; } }));

import { enqueueDownload, DEFAULT_DOWNLOAD_OPTIONS, retryJob } from '@/lib/twitch/jobs';
import { REENCODE_NOW_PRIORITY } from '@/lib/twitch/reencode-window';
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
    await db.twitchStreamer.deleteMany();
    await db.twitchJob.deleteMany();
    const streamer = await db.twitchStreamer.create({
      data: { twitchUserId: '1', login: 'a', folderName: 'a', displayName: 'A' },
    });
    const video = await db.twitchVideo.create({
      data: { twitchVideoId: '1', streamerId: streamer.id, type: 'ARCHIVE', title: 'T', twitchCreatedAt: new Date(), durationSeconds: 60 },
    });
    videoId = video.id;
  });

  const request = (overrides = {}) => ({ videoId, source: 'MANUAL' as const, options: DEFAULT_DOWNLOAD_OPTIONS, ...overrides });

  it('leaves one active job after two racing enqueues', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => enqueueDownload(request())));

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.jobId)).size).toBe(1);
    expect(await db.twitchJob.count()).toBe(1);
  });

  it('returns the existing job for a repeated client request, even after it finished', async () => {
    const user = await db.user.create({ data: { username: `u${Date.now()}`, displayName: 'U', passwordHash: 'x' } });
    const actor = { id: user.id, username: user.username };
    const first = await enqueueDownload(request({ actor, clientRequestId: 'repeat-0001' }));
    await db.twitchJob.update({ where: { id: first.jobId }, data: { state: 'DONE' } });

    const second = await enqueueDownload(request({ actor, clientRequestId: 'repeat-0001' }));

    expect(second).toEqual({ jobId: first.jobId, created: false });
    await db.twitchJob.deleteMany();
    await db.user.delete({ where: { id: user.id } });
  });

  it('allows a new download once the last one has finished', async () => {
    const first = await enqueueDownload(request());
    await db.twitchJob.update({ where: { id: first.jobId }, data: { state: 'FAILED' } });
    expect((await enqueueDownload(request())).created).toBe(true);
  });

  it('gives a job to exactly one of many claimers', async () => {
    await enqueueDownload(request());

    const claims = await Promise.all(Array.from({ length: 8 }, (_, index) => claimJob(db, `w${index}`, ['DOWNLOAD'])));

    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('takes over an expired lease and leaves a live one alone', async () => {
    const { jobId } = await enqueueDownload(request());
    await claimJob(db, 'first', ['DOWNLOAD']);
    expect(await claimJob(db, 'second', ['DOWNLOAD'])).toBeNull();

    await db.twitchJob.update({ where: { id: jobId }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    const taken = await claimJob(db, 'second', ['DOWNLOAD']);

    expect(taken?.leaseOwner).toBe('second');
    expect(taken?.attempts).toBe(2);
  });

  it('runs higher priority first and honours runAfter', async () => {
    const low = await enqueueDownload(request());
    const video = await db.twitchVideo.create({
      data: { twitchVideoId: '2', streamerId: (await db.twitchStreamer.findFirstOrThrow()).id, type: 'ARCHIVE', title: 'U', twitchCreatedAt: new Date(), durationSeconds: 60 },
    });
    const high = await enqueueDownload(request({ videoId: video.id, priority: 10 }));

    await db.twitchJob.update({ where: { id: high.jobId }, data: { runAfter: new Date(Date.now() + 60_000) } });
    expect((await claimJob(db, 'w', ['DOWNLOAD']))?.id).toBe(low.jobId);
    await db.twitchJob.update({ where: { id: high.jobId }, data: { runAfter: new Date() } });
    expect((await claimJob(db, 'w', ['DOWNLOAD']))?.id).toBe(high.jobId);
  });

  it('leaves a night re-encode waiting while claiming one asked for now', async () => {
    const night = await db.twitchJob.create({ data: { kind: 'REENCODE', videoId } });
    const urgent = await db.twitchJob.create({ data: { kind: 'REENCODE', videoId, priority: REENCODE_NOW_PRIORITY } });

    expect((await claimJob(db, 'worker', ['REENCODE'], REENCODE_NOW_PRIORITY))?.id).toBe(urgent.id);
    expect(await claimJob(db, 'worker', ['REENCODE'], REENCODE_NOW_PRIORITY)).toBeNull();
    expect((await claimJob(db, 'worker', ['REENCODE']))?.id).toBe(night.id);
  });

  it('ends a cancelled job whose worker died, and frees its video', async () => {
    const { jobId } = await enqueueDownload(request());
    await claimJob(db, 'dead', ['DOWNLOAD']);
    await db.twitchJob.update({ where: { id: jobId }, data: { cancelRequested: true, leaseUntil: new Date(Date.now() - 1000) } });

    expect(await claimJob(db, 'next', ['DOWNLOAD'])).toBeNull();

    expect((await db.twitchJob.findUniqueOrThrow({ where: { id: jobId } })).state).toBe('CANCELLED');
    expect((await enqueueDownload(request())).created).toBe(true);
  });

  it('resumes a disk-blocked job once its recheck is due, and not before', async () => {
    const { jobId } = await enqueueDownload(request());
    await db.twitchJob.update({ where: { id: jobId }, data: { state: 'BLOCKED', runAfter: new Date(Date.now() + 60_000) } });
    expect(await claimJob(db, 'w', ['DOWNLOAD'])).toBeNull();

    await db.twitchJob.update({ where: { id: jobId }, data: { runAfter: new Date(Date.now() - 1000) } });
    expect((await claimJob(db, 'w', ['DOWNLOAD']))?.id).toBe(jobId);
  });

  it('refuses a retry that would make a second active download, even racing', async () => {
    const user = await db.user.create({ data: { username: `r${Date.now()}`, displayName: 'R', passwordHash: 'x' } });
    const actor = { id: user.id, username: user.username };
    const failedA = await enqueueDownload(request());
    await db.twitchJob.update({ where: { id: failedA.jobId }, data: { state: 'FAILED' } });
    const replacement = await enqueueDownload(request());

    expect(await retryJob(failedA.jobId, actor)).toBe('active');

    await db.twitchJob.update({ where: { id: replacement.jobId }, data: { state: 'FAILED' } });
    const results = await Promise.all([retryJob(failedA.jobId, actor), retryJob(replacement.jobId, actor)]);

    expect(results.filter((result) => result === 'retried')).toHaveLength(1);
    expect(await db.twitchJob.count({ where: { state: 'QUEUED' } })).toBe(1);
    await db.twitchJob.deleteMany();
    await db.user.delete({ where: { id: user.id } });
  });

  it('records who retried a job', async () => {
    const user = await db.user.create({ data: { username: `s${Date.now()}`, displayName: 'S', passwordHash: 'x' } });
    const { jobId } = await enqueueDownload(request());
    await db.twitchJob.update({ where: { id: jobId }, data: { state: 'CANCELLED', cancelRequested: true } });

    expect(await retryJob(jobId, { id: user.id, username: user.username })).toBe('retried');

    expect(await db.twitchJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({
      state: 'QUEUED', cancelRequested: false, requestedByUsername: user.username,
    });
    await db.twitchJob.deleteMany();
    await db.user.delete({ where: { id: user.id } });
  });

  it('skips a job marked for cancellation and other job kinds', async () => {
    const { jobId } = await enqueueDownload(request());
    expect(await claimJob(db, 'w', ['REENCODE'])).toBeNull();
    await db.twitchJob.update({ where: { id: jobId }, data: { cancelRequested: true } });
    expect(await claimJob(db, 'w', ['DOWNLOAD'])).toBeNull();
  });
});
