// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TwitchVideo } from './types';
import type { VideoActions } from './use-video-actions';

const mocks = vi.hoisted(() => ({ capabilities: {} as Record<string, boolean> }));

vi.mock('@/components/permission-provider', () => ({
  useMe: () => ({ role: 'member', capabilities: mocks.capabilities }),
  hasCapability: (_me: unknown, capability: string) => mocks.capabilities[capability] === true,
}));

import { useVideoSelection } from './use-video-selection';

const video = { id: 'new', downloaded: false, fileId: null, activeJob: null } as TwitchVideo;
const saved = { id: 'saved', downloaded: true, fileId: 'file-1', activeJob: null } as TwitchVideo;
const running = { id: 'running', downloaded: false, fileId: null, activeJob: { id: 'job-1' } } as TwitchVideo;

function setup() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useVideoSelection([video, saved, running], {} as VideoActions), { wrapper });
}

describe('useVideoSelection', () => {
  beforeEach(() => {
    mocks.capabilities = {};
  });

  it('never starts a selection with a video that is being downloaded', () => {
    mocks.capabilities = { 'twitch.download': true, 'twitch.manage': true };
    expect(setup().result.current.startWith(running)).toBeUndefined();
  });

  it('keeps a saved video out of reach of a user who cannot delete it', () => {
    mocks.capabilities = { 'twitch.download': true };
    const { result } = setup();
    expect(result.current.startWith(saved)).toBeUndefined();
    expect(result.current.startWith(video)).toBeTypeOf('function');
  });

  it('keeps a new video out of reach of a user who cannot download it', () => {
    mocks.capabilities = { 'twitch.manage': true };
    const { result } = setup();
    expect(result.current.startWith(video)).toBeUndefined();
    expect(result.current.startWith(saved)).toBeTypeOf('function');
  });

  it('starts selecting with the pressed video', () => {
    mocks.capabilities = { 'twitch.download': true };
    const { result } = setup();
    act(() => result.current.startWith(video)?.());
    expect(result.current.active).toBe(true);
    expect(result.current.selectionFor(video)?.selected).toBe(true);
  });
});
