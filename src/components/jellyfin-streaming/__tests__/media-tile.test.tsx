// @vitest-environment jsdom
/* eslint-disable @next/next/no-img-element -- inspect image selection without Next image loading */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { MediaTile } from '@/components/jellyfin-streaming/media-tile';

vi.mock('@/lib/hooks/use-watch-skin', () => ({ useWatchSkin: () => 'cinematic' }));
vi.mock('@/lib/hooks/use-compact-viewport', () => ({ useCompactViewport: () => false }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/media/fade-in-image', () => ({ FadeInImage: ({ src, alt, className }: { src: string; alt: string; className: string }) => <img src={src} alt={alt} className={className} /> }));
vi.mock('@/components/jellyfin-streaming/cinematic/tile-panel', () => ({ TilePanel: () => null }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each(['portrait', 'landscape'] as const)('uses original %s artwork without painting a title over it', async (shape) => {
  const props: ComponentProps<typeof MediaTile> = {
    title: 'A readable movie', imageUrl: '/poster.jpg', landscapeUrl: '/backdrop.jpg', shape,
    bottomLeftBadge: { label: 'Requested', tone: 'purple' },
  };
  await act(async () => root.render(<MediaTile {...props} />));
  const art = container.querySelector('.hpr-cine-art')!;
  const image = art.querySelector('img')!;
  expect(image.getAttribute('src')).toBe(shape === 'portrait' ? '/poster.jpg' : '/backdrop.jpg');
  expect(image.alt).toBe('A readable movie');
  expect(image.classList.contains('object-cover')).toBe(true);
  expect(art.textContent).not.toContain('A readable movie');
  expect(art.textContent).toContain('Requested');
});
