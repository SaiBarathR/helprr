import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  runQueueCleanerCycle: vi.fn(),
  runDownloadCleanerCycle: vi.fn(),
  issueCleanupPreview: vi.fn(),
  consumeCleanupPreview: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: mocks.requireUserCapability,
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));
vi.mock('@/lib/cleanup/queue-cleaner', () => ({
  runQueueCleanerCycle: mocks.runQueueCleanerCycle,
}));
vi.mock('@/lib/cleanup/download-cleaner', () => ({
  runDownloadCleanerCycle: mocks.runDownloadCleanerCycle,
}));
vi.mock('@/lib/cleanup/scheduler', () => ({
  runQueueCleanerExclusive: (fn: () => Promise<unknown>) => fn(),
  runDownloadCleanerExclusive: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock('@/lib/cleanup/preview-store', () => {
  class InvalidCleanupPreviewError extends Error {}
  return {
    InvalidCleanupPreviewError,
    issueCleanupPreview: mocks.issueCleanupPreview,
    consumeCleanupPreview: mocks.consumeCleanupPreview,
  };
});
vi.mock('@/lib/cleanup/binding', () => {
  class StaleCleanupPreviewError extends Error {}
  return { StaleCleanupPreviewError };
});

import { POST as queuePreviewPost } from '@/app/api/cleanup/queue/preview/route';
import { POST as queueRunPost } from '@/app/api/cleanup/queue/run/route';
import { POST as downloadPreviewPost } from '@/app/api/cleanup/download/preview/route';
import { POST as downloadRunPost } from '@/app/api/cleanup/download/run/route';
import { StaleCleanupPreviewError } from '@/lib/cleanup/binding';

const binding = {
  cleaner: 'queue',
  configFingerprint: 'config',
  scopeFingerprint: 'scope',
  candidatesFingerprint: 'candidates',
  candidates: [],
};

function request(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('cleanup manual route safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserCapability.mockResolvedValue({
      ok: true,
      user: { id: 'user-1' },
      session: {},
    });
    mocks.runQueueCleanerCycle.mockResolvedValue({
      triggeredBy: 'dryRun',
      dryRun: true,
      durationMs: 1,
      skippedFailedImport: 0,
      pendingStrikes: [],
      decisions: [],
      succeeded: 0,
      failed: 0,
      outcomes: [],
      binding,
    });
    mocks.issueCleanupPreview.mockResolvedValue({
      previewToken: 't'.repeat(43),
      previewId: 'p'.repeat(43),
      expiresAt: '2026-07-14T10:05:00.000Z',
    });
  });

  it('requires cleanup.manage on every manual preview and execution route', async () => {
    mocks.requireUserCapability.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const responses = [
      await queuePreviewPost(),
      await downloadPreviewPost(),
      await queueRunPost(request('/api/cleanup/queue/run', { previewToken: 't'.repeat(43) })),
      await downloadRunPost(request('/api/cleanup/download/run', { previewToken: 't'.repeat(43) })),
    ];
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect(mocks.runQueueCleanerCycle).not.toHaveBeenCalled();
    expect(mocks.runDownloadCleanerCycle).not.toHaveBeenCalled();
    expect(mocks.issueCleanupPreview).not.toHaveBeenCalled();
    expect(mocks.consumeCleanupPreview).not.toHaveBeenCalled();
  });

  it('creates a server-bound token from the dry-run binding', async () => {
    const response = await queuePreviewPost();
    expect(response.status).toBe(200);
    expect(mocks.runQueueCleanerCycle).toHaveBeenCalledWith({ dryRun: true, triggeredBy: 'dryRun' });
    expect(mocks.issueCleanupPreview).toHaveBeenCalledWith('user-1', binding);
    await expect(response.json()).resolves.toMatchObject({ previewToken: 't'.repeat(43), decisions: [] });
  });

  it.each([
    ['/api/cleanup/queue/run', queueRunPost],
    ['/api/cleanup/download/run', downloadRunPost],
  ])('rejects a raw destructive request without a preview token: %s', async (path, post) => {
    const response = await post(request(path, { dryRun: false }));
    expect(response.status).toBe(428);
    expect(mocks.consumeCleanupPreview).not.toHaveBeenCalled();
    expect(mocks.runQueueCleanerCycle).not.toHaveBeenCalled();
    expect(mocks.runDownloadCleanerCycle).not.toHaveBeenCalled();
  });

  it('returns a conflict when the candidate snapshot drifts before execution', async () => {
    mocks.consumeCleanupPreview.mockResolvedValue({ previewId: 'preview-1', binding });
    mocks.runQueueCleanerCycle.mockRejectedValue(new StaleCleanupPreviewError());

    const response = await queueRunPost(request('/api/cleanup/queue/run', {
      previewToken: 't'.repeat(43),
    }));
    expect(response.status).toBe(409);
    expect(mocks.consumeCleanupPreview).toHaveBeenCalledWith('user-1', 'queue', 't'.repeat(43));
    await expect(response.json()).resolves.toMatchObject({ code: 'PREVIEW_STALE' });
  });
});
