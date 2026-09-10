// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MobileDetailTabs } from '../cinematic/mobile-detail-tabs';
import type { JellyfinItem } from '@/types/jellyfin';
vi.mock('@/components/ui/app-link', () => ({ default: 'a' }));
vi.mock('@/components/media/fade-in-image', () => ({ FadeInImage: () => null }));
it('selects arriving episodes by default while preserving an explicit tab choice', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  const episode = { Id: 'episode', Name: 'First episode', Type: 'Episode' } as JellyfinItem;
  const similar = [{ Id: 'other', Name: 'Related show', Type: 'Series' } as JellyfinItem];
  const render = (episodes: JellyfinItem[]) => root.render(<MobileDetailTabs episodes={episodes} seasons={[]} similar={similar} onPlay={() => {}} />);
  try {
    await act(async () => render([]));
    await act(async () => render([episode]));
    expect(host.textContent).toContain('First episode');
    const similarButton = [...host.querySelectorAll('button')].find(b => b.textContent === 'More Like This')!;
    await act(async () => similarButton.click());
    await act(async () => render([episode, { ...episode, Id: 'second' }]));
    expect(host.textContent).not.toContain('First episode');
    expect(similarButton.getAttribute('aria-current')).toBe('true');
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
