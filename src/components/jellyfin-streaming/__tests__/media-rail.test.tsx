// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaRail } from '@/components/jellyfin-streaming/media-rail';

const skin = vi.hoisted(() => ({ value: 'cinematic' }));
vi.mock('@/lib/hooks/use-watch-skin', () => ({ useWatchSkin: () => skin.value }));
vi.mock('next/link', () => ({ default: 'a' }));

let container: HTMLDivElement;
let root: Root;
let hover = true;
const observe = vi.fn();

beforeEach(() => {
  hover = true;
  skin.value = 'cinematic';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: hover, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('ResizeObserver', class {
    observe = observe;
    disconnect = vi.fn();
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  observe.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mountRail() {
  await act(async () => root.render(
    <MediaRail title="Test titles" count={4}>
      {[0, 1, 2, 3].map((index) => <div key={index} className="hpr-cine-tile" />)}
    </MediaRail>,
  ));
  const viewport = container.querySelector<HTMLElement>('.hpr-cine-row')!;
  const tiles = Array.from(container.querySelectorAll<HTMLElement>('.hpr-cine-tile'));
  const operations: string[] = [];
  viewport.getBoundingClientRect = () => {
    operations.push('read viewport');
    return { left: 0, right: 300, width: 300 } as DOMRect;
  };
  tiles.forEach((tile, index) => {
    tile.getBoundingClientRect = () => {
      operations.push(`read ${index}`);
      return { left: index * 100, right: (index + 1) * 100, width: 100 } as DOMRect;
    };
    Object.defineProperty(tile, 'dataset', { value: new Proxy({} as DOMStringMap, {
      set(target, key: string, value: string) {
        operations.push(`write ${index}`);
        target[key] = value;
        return true;
      },
    }) });
  });
  const stamp = () => act(() => viewport.dispatchEvent(new Event('pointerover', { bubbles: true })));
  return { tiles, operations, stamp };
}

describe('cinematic rail measurement', () => {
  it('reads every tile before writing hover attributes and preserves clipping/alignment', async () => {
    const { tiles, operations, stamp } = await mountRail();
    stamp();
    expect(operations.slice(0, 5)).toEqual(['read viewport', 'read 0', 'read 1', 'read 2', 'read 3']);
    expect(tiles.map((tile) => ({ ...tile.dataset }))).toEqual([
      { popClip: '0', popAlign: 'start' },
      { popClip: '0', popAlign: 'center' },
      { popClip: '0', popAlign: 'end' },
      { popClip: '1', popAlign: 'end' },
    ]);
    operations.length = 0;
    stamp();
    expect(operations.every((operation) => operation.startsWith('read'))).toBe(true);
    // One observer watches both boxes instead of independent measurement loops.
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it('does no hover layout work on a touch device', async () => {
    hover = false;
    const { operations, stamp } = await mountRail();
    stamp();
    expect(operations).toEqual([]);
    expect(observe).not.toHaveBeenCalled();
  });

  it('keeps every classic card mounted even when a caller supplies window geometry', async () => {
    skin.value = 'classic';
    await act(async () => root.render(
      <MediaRail title="Classic titles" count={20} tileClassName="aspect-2/3 w-[112px]">
        {Array.from({ length: 20 }, (_, index) => <a key={index} href={`/title/${index}`}>Title {index}</a>)}
      </MediaRail>,
    ));
    expect(container.querySelectorAll('a')).toHaveLength(20);
    expect(container.querySelectorAll('[data-rail-slot]')).toHaveLength(0);
  });

});
