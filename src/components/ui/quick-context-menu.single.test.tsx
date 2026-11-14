// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickContextMenu } from './quick-context-menu';

vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}));

const onlyDelete = [{ id: 'delete-alert', label: 'Delete alert', destructive: true, onSelect: vi.fn() }];
const touch = { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0, clientX: 10, clientY: 10 };
const menuOpen = () => screen.queryByRole('menu', { name: 'Actions for Reminder' }) !== null;

function longPress() {
  fireEvent.pointerDown(screen.getByTestId('row'), touch);
  act(() => { vi.advanceTimersByTime(800); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('quick context menu with one action', () => {
  it('stays closed by default: one action usually repeats a tap', () => {
    render(
      <QuickContextMenu label="Actions for Reminder" actions={onlyDelete}>
        <div data-testid="row">Reminder</div>
      </QuickContextMenu>,
    );
    longPress();
    expect(menuOpen()).toBe(false);
    fireEvent.contextMenu(screen.getByTestId('row'));
    expect(menuOpen()).toBe(false);
  });

  it('opens on long-press when the surface opts in, with its lone Delete', () => {
    render(
      <QuickContextMenu label="Actions for Reminder" actions={onlyDelete} allowSingleAction>
        <div data-testid="row">Reminder</div>
      </QuickContextMenu>,
    );
    longPress();
    expect(menuOpen()).toBe(true);
    expect(screen.getByRole('menuitem', { name: 'Delete alert' })).toBeTruthy();
  });

  it('opens on right-click too when the surface opts in', () => {
    render(
      <QuickContextMenu label="Actions for Reminder" actions={onlyDelete} allowSingleAction>
        <div data-testid="row">Reminder</div>
      </QuickContextMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('row'));
    expect(menuOpen()).toBe(true);
  });

  it('still stays closed with no enabled action at all', () => {
    render(
      <QuickContextMenu label="Actions for Reminder" actions={[{ ...onlyDelete[0], disabled: true }]} allowSingleAction>
        <div data-testid="row">Reminder</div>
      </QuickContextMenu>,
    );
    longPress();
    expect(menuOpen()).toBe(false);
  });
});
