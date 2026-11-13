import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(__dirname, '..', '..', path), 'utf8');
const css = postcss.parse(read('app/globals.css'));
function decls(selector: string) {
  const found: Record<string, string> = {};
  css.walkRules((rule: Rule) => {
    if (rule.selector === selector) rule.walkDecls((d) => { found[d.prop] = d.value; });
  });
  return found;
}

describe('poster overlays', () => {
  // The installed iOS app showed Safari's link preview on a long press.
  // Only in-app links: one that opens a new tab keeps Copy link and Share.
  it('turn off the iOS link callout on in-app links around an image', () => {
    expect(decls('a:not([target="_blank"]):has(img)')['-webkit-touch-callout']).toBe('none');
    expect(decls('a:not([target="_blank"]):has(img)')['user-select']).toBe('none');
    expect(decls('a:has(img)')['-webkit-touch-callout']).toBeUndefined();
  });

  // The accent itself is a deep blue under Liquid Glass (1.6-3.4:1 on the
  // black scrim), so the instance name is mostly white with a tint of it.
  it('draw the instance name on a poster scrim mostly white', () => {
    // The accent as picked: a light palette's darkened one is for its light surfaces.
    expect(decls('.hpr-scrim-accent').color).toBe('color-mix(in oklab, var(--hpr-accent-on-dark) 30%, white)');
    for (const card of ['components/media/media-card.tsx', 'components/media/collection-card.tsx']) {
      const src = read(card);
      expect(src, card).toMatch(/hpr-scrim-accent[^>]*>[^<]*\{(showYear \? ' · ' : ''\}\{)?(collection\.)?instanceLabel/);
    }
  });

  // A light palette darkens the accent for its own surfaces; on the black
  // player and the resume bars on artwork it comes back as picked (Cream Amber
  // was 2.8:1 on black and 1.4:1 against the unplayed track), with black on it.
  // Not under Liquid Glass or the Cinematic skin, which keep their own accent.
  it('give the dark surfaces of a light palette the accent as picked', () => {
    const rule = decls("html[data-scheme='light']:not([data-glass]):not([data-watch-skin='cinematic']:has(.hpr-watch)) .hpr-on-dark");
    for (const prop of ['--hpr-amber', '--hpr-seek', '--primary', '--ring']) expect(rule[prop], prop).toBe('var(--hpr-accent-on-dark)');
    expect(rule['--hpr-ink']).toBe('#000000');
    expect(rule['--primary-foreground']).toBe('#000000');
    expect(read('components/jellyfin-streaming/video-stage.tsx')).toContain("'hpr-on-dark overflow-hidden bg-black'");
    for (const file of ['components/jellyfin-streaming/poster-card.tsx', 'components/jellyfin-streaming/media-tile.tsx', 'components/jellyfin/watch-status-indicator.tsx']) {
      expect(read(file), file).toMatch(/hpr-on-dark[^'"]*bg-black\/45/);
    }
  });
});
