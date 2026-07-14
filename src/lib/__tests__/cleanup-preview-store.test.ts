import { describe, expect, it } from 'vitest';
import {
  CLEANUP_PREVIEW_TTL_SECONDS,
  consumeCleanupPreview,
  InvalidCleanupPreviewError,
  issueCleanupPreview,
  type CleanupPreviewStore,
} from '@/lib/cleanup/preview-store';
import type { CleanupExecutionBinding } from '@/lib/cleanup/types';

class MemoryPreviewStore implements CleanupPreviewStore {
  readonly records = new Map<string, string>();

  async set(key: string, value: string): Promise<boolean> {
    if (this.records.has(key)) return false;
    this.records.set(key, value);
    return true;
  }

  async getDel(key: string): Promise<string | null> {
    const value = this.records.get(key) ?? null;
    this.records.delete(key);
    return value;
  }
}

const binding: CleanupExecutionBinding = {
  cleaner: 'queue',
  configFingerprint: 'config',
  scopeFingerprint: 'scope',
  candidatesFingerprint: 'candidates',
  candidates: [],
};

function tokenGenerator(...tokens: string[]) {
  let index = 0;
  return () => tokens[index++] ?? `fallback-${index}`;
}

describe('cleanup preview tokens', () => {
  it('issues an opaque token and consumes it exactly once', async () => {
    const store = new MemoryPreviewStore();
    const now = Date.parse('2026-07-14T10:00:00.000Z');
    const issued = await issueCleanupPreview('user-1', binding, {
      store,
      now: () => now,
      randomToken: tokenGenerator('t'.repeat(43), 'p'.repeat(43)),
    });

    expect(issued.previewToken).toBe('t'.repeat(43));
    expect(issued.previewId).toBe('p'.repeat(43));
    expect(issued.expiresAt).toBe(new Date(now + CLEANUP_PREVIEW_TTL_SECONDS * 1000).toISOString());

    const consumed = await consumeCleanupPreview('user-1', 'queue', issued.previewToken, {
      store,
      now: () => now + 1,
    });
    expect(consumed.binding).toEqual(binding);

    await expect(consumeCleanupPreview('user-1', 'queue', issued.previewToken, { store, now: () => now + 2 }))
      .rejects.toBeInstanceOf(InvalidCleanupPreviewError);
  });

  it('rejects expired previews', async () => {
    const store = new MemoryPreviewStore();
    const now = Date.parse('2026-07-14T10:00:00.000Z');
    const issued = await issueCleanupPreview('user-1', binding, {
      store,
      now: () => now,
      randomToken: tokenGenerator('a'.repeat(43), 'b'.repeat(43)),
    });

    await expect(consumeCleanupPreview('user-1', 'queue', issued.previewToken, {
      store,
      now: () => now + CLEANUP_PREVIEW_TTL_SECONDS * 1000,
    })).rejects.toBeInstanceOf(InvalidCleanupPreviewError);
  });

  it('binds tokens to both the user and cleaner without consuming another binding', async () => {
    const store = new MemoryPreviewStore();
    const now = Date.parse('2026-07-14T10:00:00.000Z');
    const issued = await issueCleanupPreview('user-1', binding, {
      store,
      now: () => now,
      randomToken: tokenGenerator('c'.repeat(43), 'd'.repeat(43)),
    });

    await expect(consumeCleanupPreview('user-2', 'queue', issued.previewToken, { store, now: () => now + 1 }))
      .rejects.toBeInstanceOf(InvalidCleanupPreviewError);
    await expect(consumeCleanupPreview('user-1', 'download', issued.previewToken, { store, now: () => now + 1 }))
      .rejects.toBeInstanceOf(InvalidCleanupPreviewError);

    await expect(consumeCleanupPreview('user-1', 'queue', issued.previewToken, { store, now: () => now + 1 }))
      .resolves.toMatchObject({ previewId: 'd'.repeat(43), binding });
  });
});
