// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextActionGroup } from '@/components/ui/quick-context-menu';

const mocks = vi.hoisted(() => ({
  me: null as { role: string; capabilities: Record<string, boolean> } | null,
}));

vi.mock('@/components/permission-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/permission-provider')>()),
  useMe: () => mocks.me,
  useCan: (cap: string) => mocks.me?.role === 'admin' || mocks.me?.capabilities[cap] === true,
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/seerr/seerr-request-modal', () => ({ SeerrRequestModal: () => null }));
vi.mock('@/components/media/fade-in-image', () => ({ FadeInImage: () => null }));
// The long-press menu renders its actions inline, or nothing when the real
// menu would not open (fewer than two actions).
vi.mock('@/components/ui/quick-context-menu', () => ({
  QuickContextMenu: ({ label, groups, children }: { label: string; groups: ContextActionGroup[]; children: ReactNode }) => {
    const actions = groups.flatMap((group) => group.actions);
    return (
      <div>
        {children}
        {actions.length < 2 ? null : (
          <ul aria-label={label}>
            {actions.map((action) => (
              <li key={action.id}>{action.href ? <a href={action.href}>{action.label}</a> : action.label}</li>
            ))}
          </ul>
        )}
      </div>
    );
  },
}));

import { PendingApprovalSection } from './pending-approval-section';

const rows = [
  { id: 'p1', mediaType: 'movie', tmdbId: 1001, title: 'Whalefall', year: 2026 },
  { id: 'p2', mediaType: 'tv', tmdbId: 1002, title: 'Pending Show', year: 2026 },
].map((row) => ({
  ...row,
  posterUrl: null, is4k: false, seasons: null, profileId: null, rootFolder: null, tags: null,
  seerrUserId: null, createdAt: '2026-10-20T00:00:00.000Z', requester: null,
}));

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PendingApprovalSection /></QueryClientProvider>);
}

const menuItems = async (title: string) => {
  const menu = await screen.findByRole('list', { name: `Actions for ${title}` });
  return [...menu.querySelectorAll('li')].map((item) => [item.textContent, item.querySelector('a')?.getAttribute('href') ?? null]);
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ results: rows, pageInfo: { results: rows.length } })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PendingApprovalSection Open in Helprr', () => {
  it('lets an approver open a pending title on its Discover page', async () => {
    mocks.me = { role: 'admin', capabilities: {} };
    renderSection();
    expect(await menuItems('Whalefall')).toEqual([
      ['Open in Helprr', '/discover/movie/1001'],
      ['Approve…', null],
      ['Decline', null],
    ]);
    expect((await menuItems('Pending Show'))[0]).toEqual(['Open in Helprr', '/discover/tv/1002']);
  });

  it('gives a member who may open title pages Open in Helprr and Cancel', async () => {
    mocks.me = { role: 'member', capabilities: { 'requests.view': true, 'discover.view': true } };
    renderSection();
    expect(await menuItems('Whalefall')).toEqual([
      ['Open in Helprr', '/discover/movie/1001'],
      ['Cancel', null],
    ]);
  });

  it('gives a member who may not open title pages no menu, as before', async () => {
    mocks.me = { role: 'member', capabilities: { 'requests.view': true } };
    renderSection();
    await screen.findByText('Whalefall (2026)');
    expect(screen.queryByRole('list', { name: 'Actions for Whalefall' })).toBeNull();
  });
});
