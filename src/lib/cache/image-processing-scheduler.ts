import {
  acquireImageProcessingLease,
  type ImageAccountingRedis,
  type ImageProcessingLease,
  releaseImageProcessingLease,
} from '@/lib/cache/image-cache-accounting';
import {
  IMAGE_PROCESSING_QUEUE_MAX,
  IMAGE_PROCESSING_QUEUE_PER_USER_MAX,
  IMAGE_PROCESSING_QUEUE_WAIT_MS,
  IMAGE_PROCESSING_GLOBAL_MAX,
  IMAGE_PROCESSING_PER_USER_MAX,
} from '@/lib/cache/config';

const REDIS_RETRY_MIN_MS = 100;
const REDIS_RETRY_JITTER_MS = 150;
const SCHEDULER_STATE_KEY = '__helprrImageSchedulerState' as const;

export type ImageQueuePriority = 'visible' | 'background';
export type ImageQueueFailureReason = 'aborted' | 'capacity' | 'timeout' | 'shutdown';

export interface ScheduledImageProcessingLease {
  userKey: string;
  redisLease: ImageProcessingLease | null;
  queueWaitMs: number;
  released: boolean;
}

export type ImageQueueAcquireResult =
  | { ok: true; lease: ScheduledImageProcessingLease }
  | { ok: false; reason: ImageQueueFailureReason; queueWaitMs: number };

interface QueueWaiter {
  id: string;
  redis: ImageAccountingRedis | null;
  requesterId: string | undefined;
  userKey: string;
  priority: ImageQueuePriority;
  enqueuedAt: number;
  deadline: number;
  signal?: AbortSignal;
  timeout: ReturnType<typeof setTimeout> | null;
  abortListener: (() => void) | null;
  resolve: (result: ImageQueueAcquireResult) => void;
}

interface UserQueue {
  visible: QueueWaiter[];
  background: QueueWaiter[];
}

interface SchedulerState {
  running: number;
  runningByUser: Map<string, number>;
  queues: Map<string, UserQueue>;
  userOrder: string[];
  cursor: number;
  queued: number;
  draining: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
  sequence: number;
  shuttingDown: boolean;
}

const schedulerGlobal = globalThis as typeof globalThis & {
  [SCHEDULER_STATE_KEY]?: SchedulerState;
};

const state = (schedulerGlobal[SCHEDULER_STATE_KEY] ??= {
  running: 0,
  runningByUser: new Map<string, number>(),
  queues: new Map<string, UserQueue>(),
  userOrder: [],
  cursor: 0,
  queued: 0,
  draining: false,
  retryTimer: null,
  sequence: 0,
  shuttingDown: false,
});

function userQueueSize(queue: UserQueue | undefined): number {
  return queue ? queue.visible.length + queue.background.length : 0;
}

function cleanupWaiter(waiter: QueueWaiter): void {
  if (waiter.timeout) {
    clearTimeout(waiter.timeout);
    waiter.timeout = null;
  }
  if (waiter.signal && waiter.abortListener) {
    waiter.signal.removeEventListener('abort', waiter.abortListener);
    waiter.abortListener = null;
  }
}

function deleteEmptyUser(userKey: string): void {
  const queue = state.queues.get(userKey);
  if (userQueueSize(queue) > 0) return;
  state.queues.delete(userKey);
  const index = state.userOrder.indexOf(userKey);
  if (index < 0) return;
  state.userOrder.splice(index, 1);
  if (state.userOrder.length === 0) state.cursor = 0;
  else if (index < state.cursor) state.cursor -= 1;
  else state.cursor %= state.userOrder.length;
}

function settleQueuedWaiter(
  waiter: QueueWaiter,
  result: ImageQueueAcquireResult,
): void {
  cleanupWaiter(waiter);
  waiter.resolve(result);
}

function removeQueuedWaiter(waiter: QueueWaiter, reason: ImageQueueFailureReason): boolean {
  const queue = state.queues.get(waiter.userKey);
  if (!queue) return false;
  const list = waiter.priority === 'visible' ? queue.visible : queue.background;
  const index = list.findIndex((candidate) => candidate.id === waiter.id);
  if (index < 0) return false;
  list.splice(index, 1);
  state.queued = Math.max(0, state.queued - 1);
  deleteEmptyUser(waiter.userKey);
  settleQueuedWaiter(waiter, {
    ok: false,
    reason,
    queueWaitMs: Math.max(0, Date.now() - waiter.enqueuedAt),
  });
  return true;
}

function queueFor(userKey: string): UserQueue {
  let queue = state.queues.get(userKey);
  if (!queue) {
    queue = { visible: [], background: [] };
    state.queues.set(userKey, queue);
    state.userOrder.push(userKey);
  }
  return queue;
}

function nextWaiterForPriority(priority: ImageQueuePriority): QueueWaiter | null {
  if (state.userOrder.length === 0) return null;
  const users = state.userOrder.length;
  for (let offset = 0; offset < users; offset += 1) {
    if (state.userOrder.length === 0) return null;
    const index = (state.cursor + offset) % state.userOrder.length;
    const userKey = state.userOrder[index];
    if (!userKey || (state.runningByUser.get(userKey) ?? 0) >= IMAGE_PROCESSING_PER_USER_MAX) {
      continue;
    }
    const queue = state.queues.get(userKey);
    const list = priority === 'visible' ? queue?.visible : queue?.background;
    const waiter = list?.shift();
    if (!waiter) continue;
    state.queued = Math.max(0, state.queued - 1);
    state.cursor = state.userOrder.length > 0
      ? (index + 1) % state.userOrder.length
      : 0;
    deleteEmptyUser(userKey);
    return waiter;
  }
  return null;
}

function nextWaiter(): QueueWaiter | null {
  return nextWaiterForPriority('visible') ?? nextWaiterForPriority('background');
}

function reserveLocalSlot(userKey: string): void {
  state.running += 1;
  state.runningByUser.set(userKey, (state.runningByUser.get(userKey) ?? 0) + 1);
}

function releaseLocalSlot(userKey: string): void {
  state.running = Math.max(0, state.running - 1);
  const next = Math.max(0, (state.runningByUser.get(userKey) ?? 1) - 1);
  if (next === 0) state.runningByUser.delete(userKey);
  else state.runningByUser.set(userKey, next);
}

function requeue(waiter: QueueWaiter): void {
  const queue = queueFor(waiter.userKey);
  const list = waiter.priority === 'visible' ? queue.visible : queue.background;
  list.push(waiter);
  state.queued += 1;
}

function scheduleRedisRetry(): void {
  if (state.retryTimer || state.shuttingDown || state.queued === 0) return;
  const delay = REDIS_RETRY_MIN_MS + Math.round(Math.random() * REDIS_RETRY_JITTER_MS);
  state.retryTimer = setTimeout(() => {
    state.retryTimer = null;
    void drainQueue();
  }, delay);
  state.retryTimer.unref?.();
}

async function drainQueue(): Promise<void> {
  if (state.draining || state.shuttingDown) return;
  state.draining = true;
  let crossReplicaBlocked = false;
  try {
    let attemptsRemaining = state.queued;
    while (
      !state.shuttingDown
      && state.running < IMAGE_PROCESSING_GLOBAL_MAX
      && state.queued > 0
      && attemptsRemaining > 0
    ) {
      const waiter = nextWaiter();
      if (!waiter) break;
      attemptsRemaining -= 1;

      const waitedMs = Math.max(0, Date.now() - waiter.enqueuedAt);
      if (waiter.signal?.aborted) {
        settleQueuedWaiter(waiter, { ok: false, reason: 'aborted', queueWaitMs: waitedMs });
        continue;
      }
      if (Date.now() >= waiter.deadline) {
        settleQueuedWaiter(waiter, { ok: false, reason: 'timeout', queueWaitMs: waitedMs });
        continue;
      }

      reserveLocalSlot(waiter.userKey);
      let redisLease: ImageProcessingLease | null = null;
      if (waiter.redis) {
        let redisLeaseUnavailable = false;
        try {
          redisLease = await acquireImageProcessingLease(waiter.redis, waiter.requesterId);
        } catch {
          // Redis accounting is fail-soft. The local scheduler still bounds
          // this app instance while Redis is unavailable.
          redisLeaseUnavailable = true;
        }
        if (!redisLease && !redisLeaseUnavailable) {
          // A healthy Redis refusal means another replica owns the shared
          // capacity. Rotate this waiter to the tail and try another user.
          releaseLocalSlot(waiter.userKey);
          requeue(waiter);
          crossReplicaBlocked = true;
          continue;
        }
      }

      const waitExpired = Date.now() >= waiter.deadline;
      if (waiter.signal?.aborted || waitExpired) {
        if (waiter.redis && redisLease) {
          await releaseImageProcessingLease(waiter.redis, redisLease).catch(() => undefined);
        }
        releaseLocalSlot(waiter.userKey);
        settleQueuedWaiter(waiter, {
          ok: false,
          reason: waiter.signal?.aborted ? 'aborted' : 'timeout',
          queueWaitMs: Math.max(0, Date.now() - waiter.enqueuedAt),
        });
        continue;
      }

      settleQueuedWaiter(waiter, {
        ok: true,
        lease: {
          userKey: waiter.userKey,
          redisLease,
          queueWaitMs: waitedMs,
          released: false,
        },
      });
    }
  } finally {
    state.draining = false;
    if (crossReplicaBlocked) scheduleRedisRetry();
  }
}

export function acquireScheduledImageProcessingLease(
  redis: ImageAccountingRedis | null,
  requesterId: string | undefined,
  options: {
    waitMs?: number;
    priority?: ImageQueuePriority;
    signal?: AbortSignal;
  } = {},
): Promise<ImageQueueAcquireResult> {
  const enqueuedAt = Date.now();
  if (state.shuttingDown) {
    return Promise.resolve({ ok: false, reason: 'shutdown', queueWaitMs: 0 });
  }
  if (options.signal?.aborted) {
    return Promise.resolve({ ok: false, reason: 'aborted', queueWaitMs: 0 });
  }

  const userKey = requesterId ?? 'anonymous';
  const existingQueue = state.queues.get(userKey);
  if (
    state.queued >= IMAGE_PROCESSING_QUEUE_MAX
    || userQueueSize(existingQueue) >= IMAGE_PROCESSING_QUEUE_PER_USER_MAX
  ) {
    return Promise.resolve({ ok: false, reason: 'capacity', queueWaitMs: 0 });
  }

  return new Promise<ImageQueueAcquireResult>((resolve) => {
    const waitMs = Math.max(1, options.waitMs ?? IMAGE_PROCESSING_QUEUE_WAIT_MS);
    const waiter: QueueWaiter = {
      id: `${process.pid}:${++state.sequence}`,
      redis,
      requesterId,
      userKey,
      priority: options.priority ?? 'visible',
      enqueuedAt,
      deadline: enqueuedAt + waitMs,
      signal: options.signal,
      timeout: null,
      abortListener: null,
      resolve,
    };
    waiter.timeout = setTimeout(() => {
      removeQueuedWaiter(waiter, 'timeout');
    }, waitMs);
    waiter.timeout.unref?.();
    if (waiter.signal) {
      waiter.abortListener = () => {
        removeQueuedWaiter(waiter, 'aborted');
      };
      waiter.signal.addEventListener('abort', waiter.abortListener, { once: true });
    }

    const queue = queueFor(userKey);
    (waiter.priority === 'visible' ? queue.visible : queue.background).push(waiter);
    state.queued += 1;
    void drainQueue();
  });
}

export async function releaseScheduledImageProcessingLease(
  redis: ImageAccountingRedis | null,
  lease: ScheduledImageProcessingLease,
): Promise<void> {
  if (lease.released) return;
  lease.released = true;
  if (redis && lease.redisLease) {
    await releaseImageProcessingLease(redis, lease.redisLease).catch(() => undefined);
  }
  releaseLocalSlot(lease.userKey);
  void drainQueue();
}

export function getImageProcessingSnapshot(): {
  queueDepth: number;
  currentRunning: number;
  maxQueueDepth: number;
  maxRunning: number;
} {
  return {
    queueDepth: state.queued,
    currentRunning: state.running,
    maxQueueDepth: IMAGE_PROCESSING_QUEUE_MAX,
    maxRunning: IMAGE_PROCESSING_GLOBAL_MAX,
  };
}

export function beginImageProcessingShutdown(): void {
  state.shuttingDown = true;
  if (state.retryTimer) {
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
  }
  for (const queue of state.queues.values()) {
    for (const waiter of [...queue.visible, ...queue.background]) {
      removeQueuedWaiter(waiter, 'shutdown');
    }
  }
}
