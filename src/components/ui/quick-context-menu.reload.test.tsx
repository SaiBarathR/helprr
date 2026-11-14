// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Reload must wait for the menu's own Back entry to go: closing the menu steps
// back through history, and that step cancelled a reload started first.
const after = vi.hoisted(() => vi.fn());
vi.mock('@/lib/overlay-history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/overlay-history')>();
  return {
    ...actual,
    afterOverlayHistory: (navigate: () => void) => {
      after(navigate);
      // The real one, minus the navigation: jsdom can't reload.
      actual.afterOverlayHistory(() => {});
    },
  };
});

import { QuickContextMenu } from './quick-context-menu';
import { resetOverlayHistoryForTests } from '@/lib/overlay-history';

describe('long-press menu Reload', () => {
  beforeEach(() => {
    resetOverlayHistoryForTests();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    window.history.pushState({ __NA: true }, '', '/movies');
  });

  it('reloads after the menu has left history, not before', async () => {
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    render(
      // Two actions: a single one runs straight away instead of opening the menu.
      <QuickContextMenu label="Dune" actions={[
        { id: 'monitor', label: 'Monitor', onSelect: () => {} },
        { id: 'search', label: 'Search', onSelect: () => {} },
      ]}>
        <div>Dune poster</div>
      </QuickContextMenu>,
    );
    fireEvent.contextMenu(screen.getByText('Dune poster'));
    await waitFor(() => expect((window.history.state as Record<string, unknown>).__helprrOverlay).toBeDefined());
    const before = after.mock.calls.length;
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reload' }));
    expect(after.mock.calls.length).toBe(before + 1);
  });
});
