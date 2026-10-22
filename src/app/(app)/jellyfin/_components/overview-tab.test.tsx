// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[1] === 'system'
      ? { ServerName: 'Jellyfin', Version: '12', HasPendingRestart: true }
      : queryKey[1] === 'tasks' || queryKey[1] === 'devices' ? {} : null,
  }),
}));
vi.mock('@/lib/hooks/use-external-urls', () => ({ useExternalUrls: () => ({}) }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('@/components/jellyfin/stream-info-drawer', () => ({ StreamInfoDrawer: () => null }));

import { OverviewTab } from './overview-tab';

it('gives the restart badge a readable light-theme foreground', () => {
  render(<OverviewTab />);
  const badge = screen.getByText('Restart needed');
  expect(badge.className).toContain('text-amber-500');
  expect(badge.className).toContain('light:text-amber-700');
});
