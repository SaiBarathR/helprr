// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/hooks/use-route-view-state', () => ({
  useRouteViewState: <T,>(_key: string, initial: T) => useState(initial),
}));
vi.mock('@/components/jellyfin/watch-status-provider', () => ({ useWatchLookup: () => undefined }));

import { MediaTable, type MediaTableRow } from '../media-table';

const rows = [
  { id: 1, instanceId: 'radarr-a', title: 'Alien' },
  { id: 2, instanceId: 'radarr-a', title: 'Brazil' },
] as MediaTableRow[];

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

describe('MediaTable selection', () => {
  it('follows a changed selection', () => {
    // Stable, as a page passes them, so only the selection changes between renders.
    const onToggleSelect = () => {};
    const visibleFields: string[] = [];
    const table = (selected: string[]) => (
      <MediaTable rows={rows} visibleFields={visibleFields} type="movie" selectable selectedKeys={new Set(selected)} onToggleSelect={onToggleSelect} />
    );
    const { rerender } = render(table([]));
    expect(screen.getByRole('checkbox', { name: 'Select Alien' }).getAttribute('aria-checked')).toBe('false');

    rerender(table(['radarr-a:1']));
    expect(screen.getByRole('checkbox', { name: 'Select Alien' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: 'Select Brazil' }).getAttribute('aria-checked')).toBe('false');
  });
});
