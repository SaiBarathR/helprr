import { randomBytes } from 'crypto';
import { getRedisClient } from '@/lib/redis';
import { sha256Hex } from '@/lib/cache/keys';
import type { CleanerKind, CleanupExecutionBinding } from './types';

export const CLEANUP_PREVIEW_TTL_SECONDS = 5 * 60;

export interface StoredCleanupPreview {
  previewId: string;
  cleaner: CleanerKind;
  issuedAt: string;
  expiresAt: string;
  binding: CleanupExecutionBinding;
}

export interface IssuedCleanupPreview {
  previewId: string;
  previewToken: string;
  expiresAt: string;
}

export interface CleanupPreviewStore {
  set(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  getDel(key: string): Promise<string | null>;
}

interface PreviewDependencies {
  store: CleanupPreviewStore;
  now: () => number;
  randomToken: () => string;
}

async function defaultStore(): Promise<CleanupPreviewStore> {
  const redis = await getRedisClient();
  return {
    async set(key, value, ttlSeconds) {
      const result = await redis.set(key, value, { EX: ttlSeconds, NX: true });
      return result === 'OK';
    },
    async getDel(key) {
      return redis.getDel(key);
    },
  };
}

function defaultRandomToken(): string {
  return randomBytes(32).toString('base64url');
}

function previewKey(userId: string, cleaner: CleanerKind, token: string): string {
  return `helprr:cleanup-preview:v1:${sha256Hex(userId)}:${cleaner}:${sha256Hex(token)}`;
}

async function dependencies(overrides?: Partial<PreviewDependencies>): Promise<PreviewDependencies> {
  return {
    store: overrides?.store ?? await defaultStore(),
    now: overrides?.now ?? Date.now,
    randomToken: overrides?.randomToken ?? defaultRandomToken,
  };
}

export class InvalidCleanupPreviewError extends Error {
  constructor() {
    super('Cleanup preview is invalid, expired, already used, or belongs to another user or cleaner.');
    this.name = 'InvalidCleanupPreviewError';
  }
}

export async function issueCleanupPreview(
  userId: string,
  binding: CleanupExecutionBinding,
  overrides?: Partial<PreviewDependencies>,
): Promise<IssuedCleanupPreview> {
  const deps = await dependencies(overrides);
  const now = deps.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    const previewToken = deps.randomToken();
    const previewId = deps.randomToken();
    const record: StoredCleanupPreview = {
      previewId,
      cleaner: binding.cleaner,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CLEANUP_PREVIEW_TTL_SECONDS * 1000).toISOString(),
      binding,
    };
    const stored = await deps.store.set(
      previewKey(userId, binding.cleaner, previewToken),
      JSON.stringify(record),
      CLEANUP_PREVIEW_TTL_SECONDS,
    );
    if (stored) return { previewId, previewToken, expiresAt: record.expiresAt };
  }
  throw new Error('Could not allocate a cleanup preview token');
}

export async function consumeCleanupPreview(
  userId: string,
  cleaner: CleanerKind,
  previewToken: string,
  overrides?: Partial<PreviewDependencies>,
): Promise<StoredCleanupPreview> {
  const deps = await dependencies(overrides);
  const raw = await deps.store.getDel(previewKey(userId, cleaner, previewToken));
  if (!raw) throw new InvalidCleanupPreviewError();

  let record: StoredCleanupPreview;
  try {
    record = JSON.parse(raw) as StoredCleanupPreview;
  } catch {
    throw new InvalidCleanupPreviewError();
  }
  const expiresAt = Date.parse(record.expiresAt);
  if (
    record.cleaner !== cleaner
    || record.binding?.cleaner !== cleaner
    || !record.previewId
    || !Number.isFinite(expiresAt)
    || expiresAt <= deps.now()
  ) {
    throw new InvalidCleanupPreviewError();
  }
  return record;
}
