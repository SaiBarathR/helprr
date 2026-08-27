import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBTITLE_APPEARANCE,
  subtitleCueCss,
  subtitleCueDeclarations,
  subtitleCueLine,
} from '@/lib/jellyfin-playback/subtitle-appearance';

describe('subtitle appearance', () => {
  it('matches jellyfin-web defaults', () => {
    expect(DEFAULT_SUBTITLE_APPEARANCE.textSize).toBe('medium');
    expect(DEFAULT_SUBTITLE_APPEARANCE.verticalPosition).toBe(-3);
    expect(DEFAULT_SUBTITLE_APPEARANCE.dropShadow).toBe('dropshadow');
  });

  it('maps sizes to the same em values jellyfin-web uses', () => {
    const size = (value: Parameters<typeof subtitleCueDeclarations>[0]['textSize']) =>
      Object.fromEntries(subtitleCueDeclarations({ ...DEFAULT_SUBTITLE_APPEARANCE, textSize: value }))['font-size'];
    expect(size('medium')).toBe('1.36em');
    expect(size('large')).toBe('1.72em');
    expect(size('extralarge')).toBe('2.2em');
    expect(size('smaller')).toBe('.8em');
  });

  it('emits a scoped ::cue rule with !important so Safari captions do not win', () => {
    const css = subtitleCueCss(DEFAULT_SUBTITLE_APPEARANCE, '.player');
    expect(css.startsWith('.player::cue{')).toBe(true);
    expect(css).toContain('color:#ffffff!important;');
    expect(css).toContain('font-size:1.36em!important;');
  });

  it('reflects colour and background choices', () => {
    const css = subtitleCueCss(
      { ...DEFAULT_SUBTITLE_APPEARANCE, textColor: '#ffff00', textBackground: '#000000' },
      '.player',
    );
    expect(css).toContain('color:#ffff00!important;');
    expect(css).toContain('background-color:#000000!important;');
  });

  it('drops the shadow entirely when the edge style is none', () => {
    const css = subtitleCueCss({ ...DEFAULT_SUBTITLE_APPEARANCE, dropShadow: 'none' }, '.p');
    expect(css).toContain('text-shadow:none!important;');
  });

  it('passes vertical position through as an integer cue line', () => {
    expect(subtitleCueLine(-3)).toBe(-3);
    expect(subtitleCueLine(2.7)).toBe(2);
    expect(subtitleCueLine(Number.NaN)).toBe(-3);
  });
});
