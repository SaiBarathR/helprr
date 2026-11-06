// @vitest-environment jsdom
// Phones read the page top to bottom; on a wide content area the facts and actions sit beside
// the thumbnail and the description runs full width below (gap plan L12).
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/' }));
vi.mock('@/components/permission-provider', () => ({ useMe: () => ({ role: 'admin' }), hasCapability: () => true }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: () => null }));
vi.mock('@/components/creators/use-video-actions', () => ({ useVideoActions: () => ({ groupsFor: () => [], sheet: null }) }));
vi.mock('@/components/creators/actions-menu', () => ({ ActionsMenu: () => null }));
vi.mock('@/components/ui/quick-context-menu', () => ({ QuickContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/youtube/download-sheet', () => ({ YoutubeDownloadSheet: () => null }));

import YoutubeVideoPage from './page';

const video = {
  id: 'v1', externalId: 'abc', type: 'UPLOAD', title: 'Full Self-Driving', description: 'We tried it.', sourceCreatedAt: '2026-11-05T10:00:00Z',
  durationSeconds: 1974, thumbnailUrl: null, category: null, viewCount: 5100, mutedSegments: null, chapters: null,
  availability: 'PUBLISHED', estimatedExpiresAt: null,
  creator: { id: 'c1', login: 'ltt', displayName: 'Linus Tech Tips', profileImageUrl: null, isLive: false },
  seen: true, downloaded: false, fileId: null, jellyfinItemId: null, activeJob: null, liveEndedAt: null, ageRestricted: false,
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
      <YoutubeVideoPage params={params} />
    </QueryClientProvider>,
  );
  const title = await screen.findByRole('heading', { level: 1, name: 'Full Self-Driving' });
  const facts = screen.getByText('5,100').closest('.\\@4xl\\:col-start-2')!;
  const description = screen.getByText('We tried it.').closest('.\\@4xl\\:col-span-2')!;
  const actions = screen.getByRole('button', { name: 'Download' }).closest('.\\@4xl\\:col-start-2')!;

  const order = [title, facts, description, actions];
  for (let i = 1; i < order.length; i += 1) {
    expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(title.closest('.\\@4xl\\:col-start-2')).toBeTruthy();
});
