// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickContextMenu } from './quick-context-menu';

vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}));

// A surface with a dialog opened from inside it: the dialog sits in a portal on
// the page but inside the surface in the React tree, as the Request dialog does.
function Surface() {
  return (
    <QuickContextMenu
      label="Actions for Tenzing"
      actions={[
        { id: 'add', label: 'Add to Radarr', onSelect: () => {} },
        { id: 'request', label: 'Request', onSelect: () => {} },
      ]}
    >
      <div data-testid="hero">
        Tenzing
        {createPortal(<div data-testid="dialog">Request Movie</div>, document.body)}
      </div>
    </QuickContextMenu>
  );
}

const touch = { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0, clientX: 10, clientY: 10 };
const menuOpen = () => screen.queryByRole('menu', { name: 'Actions for Tenzing' }) !== null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('quick context menu and portals opened from inside it', () => {
  it('opens on a long press of its own surface', () => {
    render(<Surface />);
    fireEvent.pointerDown(screen.getByTestId('hero'), touch);
    act(() => { vi.advanceTimersByTime(800); });
    expect(menuOpen()).toBe(true);
  });

  it('does not open for a press inside the dialog, even when the press ends elsewhere', () => {
    render(<Surface />);
    fireEvent.pointerDown(screen.getByTestId('dialog'), touch);
    act(() => { vi.advanceTimersByTime(800); });
    expect(menuOpen()).toBe(false);
    // The lift lands outside both (a select list that opened, say).
    fireEvent.pointerUp(document, touch);
    act(() => { vi.advanceTimersByTime(800); });
    expect(menuOpen()).toBe(false);
  });

  it('still opens on its own surface after a dialog press that ended elsewhere', () => {
    render(<Surface />);
    fireEvent.pointerDown(screen.getByTestId('dialog'), touch);
    fireEvent.pointerUp(document, touch);
    fireEvent.pointerDown(screen.getByTestId('hero'), touch);
    act(() => { vi.advanceTimersByTime(800); });
    expect(menuOpen()).toBe(true);
  });

  it('does not open for a right-click inside the dialog, and does on its own surface', () => {
    render(<Surface />);
    fireEvent.contextMenu(screen.getByTestId('dialog'));
    expect(menuOpen()).toBe(false);
    fireEvent.contextMenu(screen.getByTestId('hero'));
    expect(menuOpen()).toBe(true);
  });
});
