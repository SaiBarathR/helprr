// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextActionGroup } from '@/components/ui/quick-context-menu';

const mocks = vi.hoisted(() => ({ canCustomize: true }));

vi.mock('@/components/permission-provider', () => ({
  useMe: () => null,
  hasCapabilities: () => true,
  useCan: (cap: string) => cap === 'dashboard.customize' && mocks.canCustomize,
}));
vi.mock('@/lib/widgets/registry', () => ({ getWidgetDefinition: () => ({ name: 'Stats' }) }));
vi.mock('./bento-cell', () => ({
  BentoCell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BentoEditChrome: () => null,
}));
vi.mock('./widget-renderer', () => ({ WidgetRenderer: () => null }));
// The long-press menu itself is covered elsewhere: list the actions it would offer, after
// its own normalisation (which drops empty groups).
vi.mock('@/components/ui/quick-context-menu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/quick-context-menu')>();
  return {
    ...actual,
    QuickContextMenu: ({ groups, children }: { groups: ContextActionGroup[]; children: React.ReactNode }) => (
      <div>
        {actual.normalizeContextActionGroups(groups).map((group) => (
          <div key={group.id} data-group={group.id}>
            {group.actions.map((action) => (
              <button key={action.id} type="button" onClick={() => action.onSelect?.()}>{action.label}</button>
            ))}
          </div>
        ))}
        {children}
      </div>
    ),
  };
});

import { WidgetGridItem } from './widget-grid-shared';
import { useUIStore } from '@/lib/store';

const INSTANCE = { id: 'w1', widgetId: 'stats-grid', colSpan: 1, rowSpan: 1 } as never;
const onRemove = vi.fn();
const renderItem = () => render(
  <WidgetGridItem instance={INSTANCE} editMode={false} onRemove={onRemove} onConfigureRefresh={() => {}} />,
);
const labels = () => screen.queryAllByRole('button').map((button) => button.textContent);

beforeEach(() => {
  mocks.canCustomize = true;
  onRemove.mockClear();
  useUIStore.setState({ dashboardEditMode: false });
});

describe('WidgetGridItem long-press actions', () => {
  it('offers Customize and Remove to someone who can customize the layout', async () => {
    renderItem();
    expect(labels()).toEqual(['Customize dashboard', 'Configure refresh intervals', 'Remove widget']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove widget' }));
    expect(useUIStore.getState().dashboardEditMode).toBe(true);
    expect(onRemove).toHaveBeenCalledWith('w1');
  });

  it('leaves Customize and Remove out without dashboard.customize, so nothing opens edit mode', () => {
    mocks.canCustomize = false;
    renderItem();
    expect(labels()).toEqual(['Configure refresh intervals']);
    expect(document.querySelector('[data-group="danger"]')).toBeNull();
    expect(useUIStore.getState().dashboardEditMode).toBe(false);
  });
});
