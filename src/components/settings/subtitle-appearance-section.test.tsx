// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUIStore } from '@/lib/store';
import { DEFAULT_SUBTITLE_APPEARANCE } from '@/lib/jellyfin-playback/subtitle-appearance';
import { SubtitleAppearanceSection } from './subtitle-appearance-section';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useUIStore.getState().resetSubtitleAppearance();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<SubtitleAppearanceSection />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const button = (name: string) => [...container.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name)!;
const preview = () => container.querySelector<HTMLElement>('[data-testid="subtitle-preview"]')!;

describe('SubtitleAppearanceSection', () => {
  it('writes the same store value the player reads, and previews it', () => {
    act(() => button('Subtitle colour #ffff00').click());
    act(() => button('Raise').click());
    const appearance = useUIStore.getState().subtitleAppearance;
    expect(appearance.textColor).toBe('#ffff00');
    expect(appearance.verticalPosition).toBe(DEFAULT_SUBTITLE_APPEARANCE.verticalPosition + 1);
    expect(button('Subtitle colour #ffff00').getAttribute('aria-pressed')).toBe('true');
    expect(preview().style.color).toBe('rgb(255, 255, 0)');
  });

  it('shows a change made in the player, and Reset restores the defaults', () => {
    act(() => useUIStore.getState().setSubtitleAppearance({ textColor: '#00ffff', verticalPosition: -8 }));
    expect(container.textContent).toContain('Position -8');
    expect(preview().style.color).toBe('rgb(0, 255, 255)');
    act(() => button('Reset').click());
    expect(useUIStore.getState().subtitleAppearance).toEqual(DEFAULT_SUBTITLE_APPEARANCE);
  });

  it('keeps the position within the player panel limits', () => {
    act(() => useUIStore.getState().setSubtitleAppearance({ verticalPosition: 16 }));
    act(() => button('Raise').click());
    expect(useUIStore.getState().subtitleAppearance.verticalPosition).toBe(16);
  });

  it('says the settings do not apply to ASS/SSA subtitles', () => {
    expect(container.textContent).toContain('ASS/SSA subtitles keep their own styling');
  });
});
