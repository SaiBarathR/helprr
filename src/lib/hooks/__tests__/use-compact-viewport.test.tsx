// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Cover for the wide layout flashing before the phone one.
 *
 * The cinematic skin picks *different artwork URLs* per shape, so a first
 * render that guesses wrong does not merely reflow — it requests 16:9 images
 * and leaves them on screen until the portrait ones arrive. Going back from a
 * title on a phone showed a rail of landscape cards for the better part of a
 * second because of that. What matters is not that the value settles correctly
 * but that the *first* render is already right, so these assert every render,
 * first one included.
 *
 * The hook memoises its MediaQueryList at module scope, so each case imports a
 * fresh copy after stubbing `matchMedia`.
 */

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Every value the hook returned, in render order. */
async function rendersWithViewport(matches: boolean): Promise<boolean[]> {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  const { useCompactViewport } = await import('@/lib/hooks/use-compact-viewport');

  const renders: boolean[] = [];
  function Probe() {
    renders.push(useCompactViewport());
    return null;
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<Probe />); });
  cleanup = () => { act(() => { root.unmount(); }); container.remove(); };
  return renders;
}

describe('useCompactViewport', () => {
  it('reports compact on the very first render, with no wide frame before it', async () => {
    const renders = await rendersWithViewport(true);
    expect(renders[0]).toBe(true);
    expect(renders).not.toContain(false);
  });

  it('reports wide on a desktop viewport', async () => {
    const renders = await rendersWithViewport(false);
    expect(renders.length).toBeGreaterThan(0);
    expect(renders).not.toContain(true);
  });
});
