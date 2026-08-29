import { describe, expect, it } from 'vitest';
import { canPreviewItem } from '@/components/jellyfin-streaming/cinematic/use-preview-item';
import type { JellyfinItem } from '@/types/jellyfin';

/**
 * Cover for a preview inconsistency found testing the Watch section against a
 * real Jellyfin 10.11.11 library: the same show previewed from an episode rail
 * but never from a series rail, because the card excluded every folder instead
 * of resolving the episodic ones the way the billboard and the overlay do. The
 * folder card still claimed the single hover-preview slot, so the billboard
 * stopped and nothing replaced it.
 */

const item = (over: Partial<JellyfinItem>) => ({ Id: 'x', Name: 'x', ...over }) as JellyfinItem;

describe('canPreviewItem', () => {
  it('previews a playable leaf', () => {
    expect(canPreviewItem(item({ Type: 'Episode' }))).toBe(true);
    expect(canPreviewItem(item({ Type: 'Movie' }))).toBe(true);
  });

  it('previews a series or a season, which resolve to an episode', () => {
    expect(canPreviewItem(item({ Type: 'Series', IsFolder: true }))).toBe(true);
    expect(canPreviewItem(item({ Type: 'Season', IsFolder: true }))).toBe(true);
  });

  it('leaves a folder with no representative episode on its artwork', () => {
    expect(canPreviewItem(item({ Type: 'BoxSet', IsFolder: true }))).toBe(false);
    expect(canPreviewItem(item({ Type: 'MusicAlbum', IsFolder: true }))).toBe(false);
  });

  it('previews nothing when there is no item', () => {
    expect(canPreviewItem(undefined)).toBe(false);
    expect(canPreviewItem(null)).toBe(false);
  });
});
