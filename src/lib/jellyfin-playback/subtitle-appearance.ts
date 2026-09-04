/**
 * Subtitle appearance, ported from jellyfin-web
 * `components/subtitlesettings/subtitleappearancehelper.js` (v10.11.1) and
 * applied the way `htmlVideoPlayer/plugin.js` `getCueCss` does — as a `::cue`
 * rule scoped to the player element.
 *
 * These settings apply to text subtitles rendered by the browser (WebVTT/SRT
 * via `<track>`). ASS/SSA is rendered by libass, which owns its own styling;
 * jellyfin-web has the same split, so the UI must disable these controls while
 * an ASS track is selected rather than show knobs that do nothing.
 */

export type SubtitleTextSize = 'smaller' | 'small' | 'medium' | 'large' | 'larger' | 'extralarge';
export type SubtitleTextWeight = 'normal' | 'bold';
export type SubtitleDropShadow = 'dropshadow' | 'raised' | 'depressed' | 'uniform' | 'none';
export type SubtitleFont = 'default' | 'typewriter' | 'print' | 'console' | 'cursive' | 'casual' | 'smallcaps';

export interface SubtitleAppearance {
  textSize: SubtitleTextSize;
  textWeight: SubtitleTextWeight;
  dropShadow: SubtitleDropShadow;
  font: SubtitleFont;
  textColor: string;
  textBackground: string;
  /** Line offset. Negative counts up from the bottom, matching jellyfin-web. */
  verticalPosition: number;
}

export const DEFAULT_SUBTITLE_APPEARANCE: SubtitleAppearance = {
  textSize: 'medium',
  textWeight: 'normal',
  dropShadow: 'dropshadow',
  font: 'default',
  textColor: '#ffffff',
  textBackground: 'transparent',
  verticalPosition: -3,
};

const FONT_SIZES: Record<SubtitleTextSize, string> = {
  smaller: '.8em',
  small: 'inherit',
  medium: '1.36em',
  large: '1.72em',
  larger: '2em',
  extralarge: '2.2em',
};

const DROP_SHADOWS: Record<SubtitleDropShadow, string> = {
  raised: '-0.04em -0.04em #fff, 0px -0.04em #fff, -0.04em 0px #fff, 0.04em 0.04em #000, 0px 0.04em #000, 0.04em 0px #000',
  depressed: '0.04em 0.04em #fff, 0px 0.04em #fff, 0.04em 0px #fff, -0.04em -0.04em #000, 0px -0.04em #000, -0.04em 0px #000',
  uniform: '#000 0px 0.03em, #000 0px -0.03em, #000 0px 0.05em, #000 0px -0.05em, #000 0.03em 0px, #000 -0.03em 0px, #000 0.03em 0.03em, #000 -0.03em 0.03em, #000 0.03em -0.03em, #000 -0.03em -0.03em, #000 0.03em 0.05em, #000 -0.03em 0.05em, #000 0.03em -0.05em, #000 -0.03em -0.05em, #000 0.05em 0px, #000 -0.05em 0px, #000 0.05em 0.03em, #000 -0.05em 0.03em, #000 0.05em -0.03em, #000 -0.05em -0.03em',
  none: 'none',
  dropshadow: '#000000 0px 0px 7px',
};

const FONT_FAMILIES: Record<SubtitleFont, { family: string; variant: string }> = {
  typewriter: { family: '"Courier New",monospace', variant: 'none' },
  print: { family: 'Georgia,Times New Roman,Arial,Helvetica,serif', variant: 'none' },
  console: { family: 'Consolas,Lucida Console,Menlo,Monaco,monospace', variant: 'none' },
  cursive: { family: 'Lucida Handwriting,Brush Script MT,Segoe Script,cursive,Quintessential,system-ui,-apple-system,BlinkMacSystemFont,sans-serif', variant: 'none' },
  casual: { family: 'Gabriola,Segoe Print,Comic Sans MS,Chalkboard,Short Stack,system-ui,-apple-system,BlinkMacSystemFont,sans-serif', variant: 'none' },
  smallcaps: { family: 'Copperplate Gothic,Copperplate Gothic Bold,Copperplate,system-ui,-apple-system,BlinkMacSystemFont,sans-serif', variant: 'small-caps' },
  default: { family: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol', variant: 'none' },
};

/** CSS declarations for the cue text, in jellyfin-web's order. */
export function subtitleCueDeclarations(appearance: SubtitleAppearance): Array<[string, string]> {
  const font = FONT_FAMILIES[appearance.font] ?? FONT_FAMILIES.default;
  return [
    ['font-size', FONT_SIZES[appearance.textSize] ?? FONT_SIZES.medium],
    ['font-weight', appearance.textWeight === 'bold' ? 'bold' : 'normal'],
    ['text-shadow', DROP_SHADOWS[appearance.dropShadow] ?? DROP_SHADOWS.dropshadow],
    ['background-color', appearance.textBackground || 'transparent'],
    ['color', appearance.textColor || '#ffffff'],
    ['font-family', font.family],
    ['font-variant', font.variant],
  ];
}

/**
 * A `::cue` rule for the given selector. `!important` mirrors jellyfin-web —
 * without it Safari's own caption defaults win.
 */
export function subtitleCueCss(appearance: SubtitleAppearance, selector: string): string {
  const body = subtitleCueDeclarations(appearance)
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `${name}:${value}!important;`)
    .join('');
  return `${selector}::cue{${body}}`;
}

/**
 * WebVTT `line` for the selected vertical position. jellyfin-web passes the
 * same number straight through to `cue.line`: negative counts lines up from the
 * bottom, non-negative counts down from the top.
 */
export function subtitleCueLine(verticalPosition: number): number {
  if (!Number.isFinite(verticalPosition)) return DEFAULT_SUBTITLE_APPEARANCE.verticalPosition;
  return Math.trunc(verticalPosition);
}

/**
 * Where a cue box's bottom edge should sit to clear the player chrome, as a
 * percentage of the video box height.
 *
 * `subtitleCueLine` above counts *text rows* from the bottom, which is what
 * jellyfin-web does and what the Raise/Lower control means. That only keeps
 * cues clear of the controls when a row happens to be the right size: the
 * chrome is a fixed number of pixels tall, so on a phone the two disagree.
 * At 426x876 the seek bar lands on the row-3 boundary and grazes every cue,
 * and any cue that *wraps* past its newline count — 7% of a film's cues at
 * that width — is drawn under the bar. In landscape, where the chrome is a far
 * larger share of a 350px viewport, even a plain two-row cue is crossed.
 *
 * A percentage line anchored to the box's bottom (`lineAlign: 'end'`) is
 * measured in the same units as the obstacle, so it clears the chrome exactly,
 * at any viewport, for any number of rendered rows including wrapped ones.
 *
 * Returns null when there is nothing to clear, which keeps the row-based
 * placement — and the viewer's setting — in charge whenever the chrome is down.
 */
export function cueBottomPercent(videoHeight: number, occludedPx: number): number | null {
  if (!Number.isFinite(videoHeight) || !Number.isFinite(occludedPx)) return null;
  if (videoHeight <= 0 || occludedPx <= 0) return null;
  // Chrome taller than the video box leaves nowhere legible to put a cue;
  // pinning to the top beats pinning under the controls.
  if (occludedPx >= videoHeight) return 0;
  return ((videoHeight - occludedPx) / videoHeight) * 100;
}
