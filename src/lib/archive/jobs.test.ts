import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeJob {
  id: string;
  source: string;
  state: string;
  cancelRequested: boolean;
  runAfter: Date;
  options: unknown;
  requestedByUserId: string | null;
  requestedByUsername: string | null;
  clientRequestId: string | null;
}

const store = vi.hoisted(() => ({ job: null as FakeJob | null, created: 0 }));

// Applies the update's conditions the way PostgreSQL would, so a test shows which jobs really move.
function matches(job: FakeJob, where: Record<string, unknown>): boolean {
  return job.id === where.id
    && (where.source === undefined || job.source === where.source)
    && (where.state === undefined || job.state === where.state)
    && (where.cancelRequested === undefined || job.cancelRequested === where.cancelRequested);
}

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(async () => 0),
  archiveJob: {
    findUnique: vi.fn(async () => null),
    findFirst: vi.fn(async () => (store.job ? { id: store.job.id } : null)),
    create: vi.fn(async () => {
      store.created += 1;
      return { id: 'new-job' };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<FakeJob> }) => {
      if (!store.job || !matches(store.job, where)) return { count: 0 };
      store.job = { ...store.job, ...data };
      return { count: 1 };
    }),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: { $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) } }));

import { DEFAULT_YOUTUBE_OPTIONS, enqueueDownload, type EnqueueInput } from './jobs';

const HOUR = 60 * 60_000;
const ruleOptions = { ...DEFAULT_YOUTUBE_OPTIONS };
const chosen = { ...DEFAULT_YOUTUBE_OPTIONS, quality: '2160', codec: 'av1' };
const actor = { id: 'user-1', username: 'sam' };

function waiting(overrides: Partial<FakeJob> = {}): FakeJob {
  return {
    id: 'job-1',
    source: 'RULE',
    state: 'QUEUED',
    cancelRequested: false,
    runAfter: new Date(Date.now() + 2 * HOUR),
    options: ruleOptions,
    requestedByUserId: null,
    requestedByUsername: null,
    clientRequestId: null,
    ...overrides,
  };
}

const ask = (overrides: Partial<EnqueueInput> = {}) => enqueueDownload({
  platform: 'YOUTUBE',
  videoId: 'video-1',
  source: 'MANUAL',
  options: chosen,
  actor,
  clientRequestId: 'request-0001',
  startWaitingRuleJob: true,
  ...overrides,
});

describe('a person asking for a video a rule is waiting on', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.job = null;
    store.created = 0;
  });

  it('starts the waiting rule job now, with their choices and their name', async () => {
    store.job = waiting();
    const before = Date.now();
    await expect(ask()).resolves.toEqual({ jobId: 'job-1', created: false, startedNow: true });
    expect(store.job).toMatchObject({
      source: 'MANUAL',
      state: 'QUEUED',
      options: chosen,
      requestedByUserId: 'user-1',
      requestedByUsername: 'sam',
      clientRequestId: 'request-0001',
    });
    expect(store.job.runAfter.getTime()).toBeGreaterThanOrEqual(before);
    expect(store.job.runAfter.getTime()).toBeLessThanOrEqual(Date.now());
    expect(store.created).toBe(0);
  });

  it('also starts one whose wait has passed but the worker has not taken yet', async () => {
    store.job = waiting({ runAfter: new Date(Date.now() - 1_000) });
    await expect(ask()).resolves.toEqual({ jobId: 'job-1', created: false, startedNow: true });
    expect(store.job.options).toEqual(chosen);
  });

  it('takes it over under the same lock as queuing', async () => {
    store.job = waiting();
    await ask();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.archiveJob.updateMany.mock.invocationCallOrder[0]);
  });

  it.each([
    ['running', { state: 'RUNNING' }],
    ['waiting to retry', { state: 'RETRY_WAIT' }],
    ['blocked on disk', { state: 'BLOCKED' }],
    ['someone else asked for', { source: 'MANUAL', requestedByUserId: 'user-2', requestedByUsername: 'alex' }],
    ['being cancelled', { cancelRequested: true }],
  ])('leaves a job that is %s as it is', async (_name, overrides) => {
    store.job = waiting(overrides);
    const original = { ...store.job };
    await expect(ask()).resolves.toEqual({ jobId: 'job-1', created: false });
    expect(store.job).toEqual(original);
    expect(store.created).toBe(0);
  });

  it('changes nothing without the opt-in, as the poller and Twitch use it', async () => {
    store.job = waiting();
    const original = { ...store.job };
    await expect(ask({ startWaitingRuleJob: undefined })).resolves.toEqual({ jobId: 'job-1', created: false });
    expect(tx.archiveJob.updateMany).not.toHaveBeenCalled();
    expect(store.job).toEqual(original);
  });

  it('needs a person to name, so a rule can never start another rule early', async () => {
    store.job = waiting();
    await expect(ask({ actor: null, source: 'RULE' })).resolves.toEqual({ jobId: 'job-1', created: false });
    expect(tx.archiveJob.updateMany).not.toHaveBeenCalled();
  });

  it('still queues a new download when nothing is waiting', async () => {
    await expect(ask()).resolves.toEqual({ jobId: 'new-job', created: true });
    expect(tx.archiveJob.updateMany).not.toHaveBeenCalled();
  });
});
