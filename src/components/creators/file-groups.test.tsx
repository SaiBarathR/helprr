// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveFile, FileGroup } from './file-types';
import type { FileActions } from './use-file-actions';

vi.mock('@/components/media/fade-in-image', () => ({ FadeInImage: () => null }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

import { FileGroups } from './file-groups';
import { CreatorPlatformProvider } from './platform';

const file = (id: string, title: string) => ({
  id, videoId: `v-${id}`, title, thumbnailUrl: null, sizeBytes: 100 * 1024 * 1024, durationSeconds: 600, videoCodec: 'h264',
  width: 1920, height: 1080, keepForever: false, jellyfinItemId: 'item', reencodedAt: null, reencodeSkippedAt: null,
  originalKept: false, clearsAt: null, watchedAt: null, activeJob: null,
  creator: { id: 'c1', displayName: 'Linus Tech Tips', profileImageUrl: null },
}) as unknown as ArchiveFile;

const group: FileGroup = {
  creator: { id: 'c1', displayName: 'Linus Tech Tips', profileImageUrl: null },
  total: 5,
  totalBytes: 2.1 * 1024 ** 3,
  files: [file('a', 'GTA 6 on PC'), file('b', 'I Doubled My GPU'), file('c', 'Pros Try AI Tools')],
};
const actions = { groupsFor: () => [], swipeFor: () => ({}) } as unknown as FileActions;

function show(groups: FileGroup[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CreatorPlatformProvider platform="youtube">
        <FileGroups groups={groups} params="sort=newest" actions={actions} cleanupDue={new Set()} />
      </CreatorPlatformProvider>
    </QueryClientProvider>,
  );
}

describe('FileGroups', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      files: ['a', 'b', 'c', 'd', 'e'].map((id) => file(id, `Video ${id}`)), total: 5, page: 1, pageSize: 30,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('heads each channel with its count and size, linking to its page', () => {
    show([group]);
    const header = screen.getByRole('link', { name: /Linus Tech Tips/ });
    expect(header.getAttribute('href')).toBe('/youtube/channels/c1');
    expect(header.textContent).toContain('5 videos · 2.1 GB');
  });

  it('shows the newest files as Library rows, then opens the rest in place', async () => {
    show([group]);
    expect(screen.getByText('GTA 6 on PC')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Linus Tech Tips' }).textContent?.match(/Linus Tech Tips/g)).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /Show all 5/ }));
    await waitFor(() => expect(screen.getByText('Video e')).toBeTruthy());
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain('streamer=c1');
    expect(String(url)).toContain('sort=newest');
    expect(screen.getByRole('button', { name: /Show less/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('offers no Show all when every file is already there', () => {
    show([{ ...group, total: 3 }]);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });
});
