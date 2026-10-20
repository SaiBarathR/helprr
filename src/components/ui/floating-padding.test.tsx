// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({ props: {} as Record<string, Record<string, unknown>>, bases: [] as unknown[] }));

// The hook marks its result with the base it was given, so each component's
// wiring (base in, padding out to Radix) is visible.
vi.mock('@/lib/hooks/use-safe-area-padding', () => ({
  useSafeAreaPadding: (base: number) => {
    captured.bases.push(base);
    return { top: 1000 + base, right: base, bottom: 2000 + base, left: base };
  },
}));
vi.mock('radix-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('radix-ui')>();
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const capture = (name: string) => (props: Record<string, unknown>) => {
    captured.props[name] = props;
    return null;
  };
  return {
    ...actual,
    Select: { ...actual.Select, Portal: Passthrough, Content: capture('select') },
    DropdownMenu: { ...actual.DropdownMenu, Portal: Passthrough, Content: capture('dropdown') },
    ContextMenu: { ...actual.ContextMenu, Portal: Passthrough, Content: capture('context') },
    Popover: { ...actual.Popover, Portal: Passthrough, Content: capture('popover') },
  };
});

import { SelectContent } from './select';
import { DropdownMenuContent } from './dropdown-menu';
import { ContextMenuContent } from './context-menu';
import { PopoverContent } from './popover';

beforeEach(() => {
  captured.props = {};
  captured.bases = [];
});
afterEach(cleanup);

describe('floating menus keep clear of the safe area', () => {
  it('pads each kind of menu from the safe area, 8 px by default', () => {
    render(<><SelectContent /><DropdownMenuContent /><ContextMenuContent /><PopoverContent /></>);
    for (const name of ['select', 'dropdown', 'context', 'popover']) {
      expect(captured.props[name].collisionPadding).toEqual({ top: 1008, right: 8, bottom: 2008, left: 8 });
    }
    expect(captured.bases).toEqual([8, 8, 8, 8]);
  });

  it("adds the insets to a caller's own padding", () => {
    render(<><ContextMenuContent collisionPadding={12} /><PopoverContent collisionPadding={4} /></>);
    expect(captured.props.context.collisionPadding).toEqual({ top: 1012, right: 12, bottom: 2012, left: 12 });
    expect(captured.props.popover.collisionPadding).toEqual({ top: 1004, right: 4, bottom: 2004, left: 4 });
  });

  it('opens selects as a popper', () => {
    render(<SelectContent />);
    expect(captured.props.select.position).toBe('popper');
  });

  it('caps a popover to the room left and lets it scroll', () => {
    render(<PopoverContent />);
    const classes = String(captured.props.popover.className).split(/\s+/);
    expect(classes).toContain('max-h-(--radix-popover-content-available-height)');
    expect(classes).toContain('overflow-y-auto');
  });
});
