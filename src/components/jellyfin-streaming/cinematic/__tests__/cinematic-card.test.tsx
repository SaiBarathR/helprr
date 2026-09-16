// @vitest-environment jsdom
/* eslint-disable @next/next/no-img-element -- inspect image selection without Next image loading */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CinematicCard } from '@/components/jellyfin-streaming/cinematic/cinematic-card';
import type { JellyfinItem } from '@/types/jellyfin';

const viewport = vi.hoisted(() => ({ compact: false }));
vi.mock('@/lib/hooks/use-compact-viewport', () => ({ useCompactViewport: () => viewport.compact }));
vi.mock('@/components/ui/app-link', () => ({ default: 'a' }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => false }));
vi.mock('@/lib/store', () => ({ useUIStore: () => false }));
vi.mock('@/components/jellyfin-streaming/cinematic/watch-modal', () => ({ useWatchModal: () => null }));
vi.mock('@/components/jellyfin-streaming/cinematic/use-favorite-toggle', () => ({ useFavoriteToggle: () => ({}) }));
vi.mock('@/components/jellyfin-streaming/cinematic/use-preview-item', () => ({ canPreviewItem: () => false, usePreviewSource: () => ({}) }));
vi.mock('@/components/jellyfin-streaming/cinematic/hover-preview-slot', () => ({ useHoverPreviewSlot: () => false }));
vi.mock('@/components/jellyfin-streaming/cinematic/media-preview', () => ({ useMediaPreview: () => 'idle' }));
vi.mock('@/components/media/fade-in-image', () => ({
  FadeInImage: ({ src, alt, className }: { src: string; alt: string; className: string }) => <img src={src} alt={alt} className={className} />,
}));
vi.mock('@/components/jellyfin-streaming/cinematic/tile-panel', () => ({
  TilePanel: ({ onPlay }: { onPlay?: () => void }) => <button onClick={onPlay}>Play original item</button>,
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  viewport.compact = false;
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

const episode: JellyfinItem = {
  Id: 'episode-12', Name: 'Episode 12', Type: 'Episode', SeriesId: 'show', SeriesName: 'The Show',
  ImageTags: { Primary: 'episode-still' }, SeriesThumbImageTag: 'show-title-art',
};

it('uses show artwork without requiring a row-specific identity option and still plays the episode', async () => {
  const play = vi.fn();
  await act(async () => root.render(<CinematicCard item={episode} onPlay={play} />));
  const art = container.querySelector('.hpr-cine-art')!;
  expect(art.querySelector('img')!.getAttribute('src')).toContain('itemId=show&type=Thumb');
  expect(container.firstElementChild!.classList.contains('aspect-video')).toBe(true);
  expect(art.textContent).not.toContain('Episode 12');
  expect(art.textContent).not.toContain('The Show');
  await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Play original item')!.click());
  expect(play).toHaveBeenCalledWith(episode);
});

it('preserves the entire series poster on mobile', async () => {
  viewport.compact = true;
  await act(async () => root.render(<CinematicCard item={episode} />));
  const image = container.querySelector('img')!;
  expect(image.getAttribute('src')).toContain('itemId=show&type=Primary');
  expect(image.classList.contains('object-cover')).toBe(true);
});
