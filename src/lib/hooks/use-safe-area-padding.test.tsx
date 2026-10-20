// @vitest-environment jsdom

import { act } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no env(); the hook's probe reads these as the device's insets.
const insets = { top: '47px', right: '0px', bottom: '34px', left: '0px' };
const realGetComputedStyle = window.getComputedStyle;

function Probe({ base, name }: { base: number | { top?: number; bottom?: number }; name?: string }) {
  const padding = useSafeAreaPadding(base);
  return <output aria-label={name}>{JSON.stringify(padding)}</output>;
}

let useSafeAreaPadding: typeof import('./use-safe-area-padding').useSafeAreaPadding;

beforeEach(async () => {
  document.querySelectorAll('[data-safe-area-probe]').forEach((el) => el.remove());
  Object.assign(insets, { top: '47px', right: '0px', bottom: '34px', left: '0px' });
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    if ((el as HTMLElement).hasAttribute?.('data-safe-area-probe')) {
      return { paddingTop: insets.top, paddingRight: insets.right, paddingBottom: insets.bottom, paddingLeft: insets.left } as CSSStyleDeclaration;
    }
    return realGetComputedStyle(el, pseudo);
  });
  // A fresh module per test: the insets are cached at module level.
  vi.resetModules();
  ({ useSafeAreaPadding } = await import('./use-safe-area-padding'));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const shown = () => JSON.parse(screen.getByRole('status').textContent ?? '{}');

describe('useSafeAreaPadding', () => {
  it('adds the safe-area insets to a number on every side', () => {
    render(<Probe base={8} />);
    expect(shown()).toEqual({ top: 55, right: 8, bottom: 42, left: 8 });
  });

  it('adds them to each side of an object, treating missing sides as 0', () => {
    render(<Probe base={{ top: 4 }} />);
    expect(shown()).toEqual({ top: 51, right: 0, bottom: 34, left: 0 });
  });

  it('follows a rotation (resize) to the new insets', () => {
    render(<Probe base={8} />);
    Object.assign(insets, { top: '0px', right: '47px', bottom: '21px', left: '47px' });
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(shown()).toEqual({ top: 8, right: 55, bottom: 29, left: 55 });
  });

  it('measures once and reuses it until a resize changes the insets', () => {
    const spy = vi.mocked(window.getComputedStyle);
    const { rerender } = render(<Probe base={8} />);
    const reads = () => spy.mock.calls.filter(([el]) => (el as HTMLElement).hasAttribute?.('data-safe-area-probe')).length;
    expect(reads()).toBe(1);
    rerender(<Probe base={12} />);
    expect(reads()).toBe(1);
    expect(shown().top).toBe(59);
  });

  it('pads by the base alone where there are no insets', () => {
    Object.assign(insets, { top: '', right: '', bottom: '', left: '' });
    render(<Probe base={8} />);
    expect(shown()).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
  });

  it('moves every mounted menu to the new insets on a rotation, not just one', () => {
    render(<><Probe base={8} name="a" /><Probe base={8} name="b" /></>);
    Object.assign(insets, { top: '0px', right: '47px', bottom: '21px', left: '47px' });
    act(() => { window.dispatchEvent(new Event('resize')); });
    for (const name of ['a', 'b']) {
      expect(JSON.parse(screen.getByRole('status', { name }).textContent ?? '{}')).toEqual({ top: 8, right: 55, bottom: 29, left: 55 });
    }
  });

  it('listens once for the whole app, and stops when the last menu unmounts', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const resizes = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === 'resize').length;
    const { unmount } = render(<>{[1, 2, 3, 4, 5].map((n) => <Probe key={n} base={8} name={String(n)} />)}</>);
    expect(resizes(add)).toBe(1);
    unmount();
    expect(resizes(remove)).toBe(1);
  });

  it('measures again when the app comes back to the foreground', () => {
    render(<Probe base={8} />);
    Object.assign(insets, { top: '59px' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(shown().top).toBe(67);
  });

  it('puts the probe back if something removed it from the page', () => {
    render(<Probe base={8} />);
    expect(document.querySelectorAll('[data-safe-area-probe]')).toHaveLength(1);
    document.querySelector('[data-safe-area-probe]')!.remove();
    Object.assign(insets, { top: '20px' });
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(document.querySelector('[data-safe-area-probe]')).not.toBeNull();
    expect(shown().top).toBe(28);
  });
});
