// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countEnabledContextActions } from '@/components/ui/quick-context-menu';
import type { TwitchFile } from './file-types';

const mocks = vi.hoisted(() => ({ capabilities: {} as Record<string, boolean> }));

vi.mock('@/components/permission-provider', () => ({
  useMe: () => ({ role: 'member', capabilities: mocks.capabilities }),
  hasCapability: (_me: unknown, capability: string) => mocks.capabilities[capability] === true,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CONFIRMATIONS, useFileActions } from './use-file-actions';

const file = {
  id: 'f',
  videoId: 'v',
  twitchVideoId: '100',
  title: 'A stream',
  sizeBytes: 300,
  videoCodec: 'h264',
  keepForever: false,
  jellyfinItemId: 'item',
  reencodedAt: null,
  originalKept: false,
  originalSizeBytes: null,
  activeJob: null,
} as unknown as TwitchFile;
const reencoded = { ...file, videoCodec: 'hevc', reencodedAt: '2026-10-31T00:00:00.000Z', originalKept: true, originalSizeBytes: 1000 };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(() => useFileActions(), { wrapper }) };
}

const ids = (groups: ReturnType<ReturnType<typeof useFileActions>['groupsFor']>) =>
  groups.flatMap((group) => group.actions.map((action) => action.id));

describe('the restore confirmation', () => {
  it('says how much more space a restore uses', () => {
    expect(CONFIRMATIONS.restore.description(reencoded as TwitchFile)).toContain('uses 700 B more space');
  });

  it('reads properly when the original size was never recorded', () => {
    const text = CONFIRMATIONS.restore.description({ ...reencoded, originalSizeBytes: null } as TwitchFile);
    expect(text).toContain('uses more space');
    expect(text).not.toContain('more more');
  });
});

describe('useFileActions', () => {
  beforeEach(() => {
    mocks.capabilities = { 'twitch.view': true, 'twitch.manage': true };
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('gives every file a long-press menu, even for someone who can only look', () => {
    mocks.capabilities = { 'twitch.view': true };
    const { result } = setup();
    expect(countEnabledContextActions(result.current.groupsFor(file))).toBeGreaterThanOrEqual(2);
  });

  it('offers a viewer nothing that changes a file', () => {
    mocks.capabilities = { 'twitch.view': true };
    const { result } = setup();
    expect(ids(result.current.groupsFor(reencoded))).toEqual(['open', 'video', 'play', 'twitch']);
    expect(result.current.swipeFor(reencoded)).toEqual({ leftAction: undefined, rightAction: undefined });
  });

  it('only offers a re-encode to a file that can have one', () => {
    const { result } = setup();
    expect(ids(result.current.groupsFor(file))).toEqual(expect.arrayContaining(['now', 'tonight']));
    expect(ids(result.current.groupsFor(reencoded))).not.toContain('now');
    expect(ids(result.current.groupsFor({ ...file, videoCodec: 'hevc' }))).not.toContain('now');
  });

  it('lets a waiting re-encode be moved up, but not a running one', () => {
    const { result } = setup();
    const waiting = { id: 'j', kind: 'REENCODE', state: 'QUEUED', stage: null, progress: null, priority: 0 } as const;
    expect(result.current.canReencode({ ...file, activeJob: waiting })).toBe(true);
    expect(result.current.canReencode({ ...file, activeJob: { ...waiting, state: 'RUNNING' } })).toBe(false);
  });

  it('only offers the original controls while it exists', () => {
    const { result } = setup();
    expect(ids(result.current.groupsFor(reencoded))).toEqual(expect.arrayContaining(['restore', 'delete-original']));
    expect(ids(result.current.groupsFor({ ...reencoded, originalKept: false }))).not.toContain('restore');
  });

  it('holds back destructive actions while a job is on the file', () => {
    const { result } = setup();
    const busy = { ...reencoded, activeJob: { id: 'j', kind: 'DELETE_ORIGINAL', state: 'QUEUED', stage: null, progress: null, priority: 0 } } as TwitchFile;
    const actions = ids(result.current.groupsFor(busy));
    expect(actions).not.toContain('delete');
    expect(actions).not.toContain('restore');
    expect(result.current.swipeFor(busy).rightAction).toBeUndefined();
  });

  it('answers Keep forever in the list before the server does', async () => {
    const { client, result } = setup();
    client.setQueryData(['twitch', 'files', 'list'], { pages: [{ files: [file] }], pageParams: [1] });

    act(() => result.current.swipeFor(file).leftAction?.onAction());

    await waitFor(() => {
      const list = client.getQueryData<{ pages: Array<{ files: TwitchFile[] }> }>(['twitch', 'files', 'list']);
      expect(list?.pages[0].files[0].keepForever).toBe(true);
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/twitch/files/f', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ keepForever: true }) }));
  });

  it('puts Keep forever back when the server refuses, as a video that only looks protected is not', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"No"}', { status: 500 })));
    const { client, result } = setup();
    client.setQueryData(['twitch', 'files', 'list'], { pages: [{ files: [file] }], pageParams: [1] });
    client.setQueryData(['twitch', 'file', 'f'], file);

    act(() => result.current.setKeepForever(file, true));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    await waitFor(() => {
      const list = client.getQueryData<{ pages: Array<{ files: TwitchFile[] }> }>(['twitch', 'files', 'list']);
      expect(list?.pages[0].files[0].keepForever).toBe(false);
      expect(client.getQueryData<TwitchFile>(['twitch', 'file', 'f'])?.keepForever).toBe(false);
    });
  });

  it('asks before it deletes', () => {
    const { result } = setup();
    act(() => result.current.swipeFor(file).rightAction?.onAction());
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
