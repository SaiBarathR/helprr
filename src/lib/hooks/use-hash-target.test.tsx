// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHashTarget } from './use-hash-target';

let resize: (() => void) | null = null;
const scrollIntoView = vi.fn();

function Section() {
  const ref = useHashTarget<HTMLDivElement>('quiet-hours');
  return <div id="quiet-hours" ref={ref} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() { resize = null; }
  });
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

it('does nothing without its hash', () => {
  window.history.replaceState(null, '', '/settings/notifications');
  render(<Section />);
  resize?.();
  expect(scrollIntoView).not.toHaveBeenCalled();
});

it('scrolls to the section and keeps it there while the page above loads', () => {
  window.history.replaceState(null, '', '/settings/notifications#quiet-hours');
  render(<Section />);
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });

  // The event list above loads and the page grows.
  resize?.();
  expect(scrollIntoView).toHaveBeenCalledTimes(2);
});

it('lets go at the first scroll or tap', () => {
  window.history.replaceState(null, '', '/settings/notifications#quiet-hours');
  render(<Section />);
  window.dispatchEvent(new Event('touchstart'));
  resize?.();
  document.dispatchEvent(new Event('animationend'));
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
});

it('lets go after a few seconds', () => {
  window.history.replaceState(null, '', '/settings/notifications#quiet-hours');
  render(<Section />);
  vi.advanceTimersByTime(3000);
  resize?.();
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
});

it('drops the hash once it lets go, so Back or Forward to this entry restores the saved position instead', () => {
  window.history.replaceState(null, '', '/settings/notifications?tab=a#quiet-hours');
  render(<Section />);
  expect(window.location.hash).toBe('#quiet-hours');
  window.dispatchEvent(new Event('wheel'));
  expect(window.location.hash).toBe('');
  expect(window.location.pathname + window.location.search).toBe('/settings/notifications?tab=a');
});

it('leaves the next page’s address alone when it unmounts before letting go', () => {
  window.history.replaceState(null, '', '/settings/notifications#quiet-hours');
  const view = render(<Section />);
  window.history.replaceState(null, '', '/settings/devices#top');
  view.unmount();
  expect(window.location.pathname + window.location.hash).toBe('/settings/devices#top');
});
