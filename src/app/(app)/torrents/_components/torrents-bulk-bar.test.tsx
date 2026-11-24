// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const viewport = vi.hoisted(() => ({ width: 389 }));
// useIsMobile's own query: (max-width: <n>px).
vi.stubGlobal('matchMedia', (query: string) => ({
  get matches() { return viewport.width <= Number(/max-width: ([\d.]+)px/.exec(query)?.[1]); },
  addEventListener() {},
  removeEventListener() {},
}));
// The ⋯ menu as a plain list of its items.
vi.mock('@/components/ui/responsive-menu', () => ({
  ResponsiveMenu: ({ trigger, children }: { trigger: React.ReactNode; children: React.ReactNode }) => <div>{trigger}<div role="menu">{children}</div></div>,
  ResponsiveMenuActionItem: ({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) => (
    <button type="button" role="menuitem" onClick={onSelect}>{children}</button>
  ),
}));

import { TorrentsBulkBar } from './torrents-bulk-bar';

function renderBar() {
  return render(
    <TorrentsBulkBar
      selectedTorrents={new Set(['a', 'b'])}
      canManageTorrents
      bulkAction={vi.fn()}
      canBandwidthTorrents
      openBulkSpeedLimits={vi.fn()}
      openOrganize={vi.fn()}
      openBulkCategory={vi.fn()}
      canDeleteTorrents
      setDeleteDrawer={vi.fn()}
      setSelectedTorrents={vi.fn()}
    />,
  );
}

beforeEach(() => {
  viewport.width = 389;
});

// The bar's button hides below 390px in CSS (max-[390px] is width < 390px); the
// ⋯ menu offers it at the same widths, so at 389px it is in one place only.
it.each([
  [320, true],
  [389, true],
  [389.5, true],
  [390, false],
  [1440, false],
])('at %spx, Location, Tags & Queue is in the ⋯ menu: %s', (width, inMenu) => {
  viewport.width = width;
  renderBar();
  expect(screen.getByRole('button', { name: 'Location, Tags & Queue' }).className).toContain('max-[390px]:hidden');
  expect(screen.queryByRole('menuitem', { name: 'Location, Tags & Queue' }) !== null).toBe(inMenu);
});

it('keeps phone toasts clear of it', () => {
  const { container } = renderBar();
  expect(container.firstElementChild?.hasAttribute('data-toast-clearance')).toBe(true);
});
