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
