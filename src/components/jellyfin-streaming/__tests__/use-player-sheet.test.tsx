// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerSheet } from '@/components/jellyfin-streaming/use-player-sheet';

let container: HTMLDivElement;
let root: Root;
const finishExit = () => container.querySelector<HTMLButtonElement>('button')!.click();
const listeners = new Set<() => void>();
const motion = {
  matches: false,
  addEventListener: (_: string, listener: () => void) => listeners.add(listener),
  removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
};

function Sheet({ open }: { open: boolean }) {
  const sheet = usePlayerSheet(open);
  return (
    <div data-present={sheet.present} data-exiting={sheet.exiting}>
      <video />
      <button onClick={sheet.finishExit}>Finish exit</button>
    </div>
  );
}

async function render(open: boolean) {
  await act(async () => root.render(<Sheet open={open} />));
}

const present = () => container.firstElementChild?.getAttribute('data-present') === 'true';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => motion);
  motion.matches = false;
  listeners.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('player sheet exit', () => {
  it('retains the sheet until animation completion without remounting its video', async () => {
    await render(true);
    const video = container.querySelector('video');
    await render(false);
    expect(present()).toBe(true);
    expect(container.firstElementChild?.getAttribute('data-exiting')).toBe('true');
    act(() => finishExit());
    expect(present()).toBe(false);
    expect(container.querySelector('video')).toBe(video);
  });

  it('finishes a cancelled or missing animation through the bounded fallback', async () => {
    await render(true);
    await render(false);
    act(() => vi.advanceTimersByTime(219));
    expect(present()).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(present()).toBe(false);
  });

  it('ignores a stale exit completion after the player reopens', async () => {
    await render(true);
    await render(false);
    const staleCompletion = finishExit;
    act(() => vi.advanceTimersByTime(100));
    await render(true);
    act(() => { staleCompletion(); vi.advanceTimersByTime(1000); });
    expect(present()).toBe(true);
    expect(container.firstElementChild?.getAttribute('data-exiting')).toBe('false');
  });

  it('closes immediately when reduced motion is already enabled', async () => {
    motion.matches = true;
    await render(true);
    await render(false);
    expect(present()).toBe(false);
    expect(listeners.size).toBe(0);
  });

  it('finishes an in-flight exit when reduced motion is enabled', async () => {
    await render(true);
    await render(false);
    act(() => {
      motion.matches = true;
      listeners.forEach((listener) => listener());
    });
    expect(present()).toBe(false);
    expect(listeners.size).toBe(0);
  });
});
