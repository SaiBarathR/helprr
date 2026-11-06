// @vitest-environment jsdom
// Phones read the page top to bottom; on a wide content area the facts and actions sit beside
// the thumbnail and the description and chapters run full width below (gap plan L12).
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/' }));
vi.mock('@/components/permission-provider', () => ({ useMe: () => ({ role: 'admin' }), hasCapability: () => true }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: () => null }));
vi.mock('@/components/creators/use-video-actions', () => ({ useVideoActions: () => ({ groupsFor: () => [], sheet: null, deleteFiles: vi.fn() }) }));
vi.mock('@/components/creators/actions-menu', () => ({ ActionsMenu: () => null }));
vi.mock('@/components/ui/quick-context-menu', () => ({ QuickContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/twitch/download-sheet', () => ({ DownloadSheet: () => null }));

import TwitchVodPage from './page';

const video = {
  id: 'v1', externalId: '123', type: 'ARCHIVE', title: 'Vibe coding', description: 'A long stream.', sourceCreatedAt: '2026-10-21T10:00:00Z',
  durationSeconds: 9000, thumbnailUrl: null, category: 'Software', viewCount: 20817, mutedSegments: null,
  chapters: [{ start: 0, title: 'Intro' }], availability: 'PUBLISHED', estimatedExpiresAt: null,
  creator: { id: 's1', login: 'prime', displayName: 'ThePrimeagen', profileImageUrl: null, isLive: false },
  seen: true, downloaded: false, fileId: null, jellyfinItemId: null, activeJob: null,
  autoDownload: { enabled: false, reason: 'off in global', trace: {} },
};

// Already settled, as React marks a resolved promise, so `use` reads it without suspending.
const params = Object.assign(Promise.resolve({ id: 'v1' }), { status: 'fulfilled', value: { id: 'v1' } });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(video)));
});
afterEach(() => vi.unstubAllGlobals());

it('keeps the phone order and puts facts and actions beside the thumbnail on wide screens', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TwitchVodPage params={params} />
    </QueryClientProvider>,
  );
  const title = await screen.findByRole('heading', { level: 1, name: 'Vibe coding' });
  const facts = screen.getByText('Software').closest('.\\@4xl\\:col-start-2')!;
  const description = screen.getByText('A long stream.').closest('.\\@4xl\\:col-span-2')!;
  const actions = screen.getByRole('button', { name: 'Download' }).closest('.\\@4xl\\:col-start-2')!;
  const chapters = screen.getByRole('region', { name: 'Chapters' });

  const order = [title, facts, description, actions, chapters];
  for (let i = 1; i < order.length; i += 1) {
    expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(title.closest('.\\@4xl\\:col-start-2')).toBeTruthy();
  expect(chapters.className).toContain('@4xl:col-span-2');
});
