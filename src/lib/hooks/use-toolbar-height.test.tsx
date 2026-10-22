// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useToolbarHeight } from './use-toolbar-height';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('measures the full toolbar on mount, follows size changes, and disconnects', () => {
  let height = 144;
  let notifyResize: () => void = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height }) as DOMRect);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notifyResize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  function Toolbar() {
    const { toolbarRef, toolbarStyle } = useToolbarHeight();
    return <div style={toolbarStyle} data-testid="page"><div ref={toolbarRef} data-testid="toolbar" /></div>;
  }
  const { unmount } = render(<Toolbar />);
  const offset = () => screen.getByTestId('page').style.getPropertyValue('--page-toolbar-height');
  expect(offset()).toBe('144px');
  expect(observe).toHaveBeenCalledWith(screen.getByTestId('toolbar'), { box: 'border-box' });
  height = 188.5;
  act(() => notifyResize());
  expect(offset()).toBe('188.5px');
  height = 96;
  act(() => notifyResize());
  expect(offset()).toBe('96px');
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it('leaves the table its fallback offset until the toolbar has been measured', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height: 0 }) as DOMRect);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  function Toolbar() {
    const { toolbarRef, toolbarStyle } = useToolbarHeight();
    return <div style={toolbarStyle} data-testid="page"><div ref={toolbarRef} /></div>;
  }
  render(<Toolbar />);
  expect(screen.getByTestId('page').style.getPropertyValue('--page-toolbar-height')).toBe('');
});
