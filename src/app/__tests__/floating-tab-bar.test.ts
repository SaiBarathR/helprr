import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

// The detached phone tabs + round Search live in globals.css, which jsdom cannot lay
// out, so this pins the CSS contract (as landscape-safe-area.test.ts does).
const css = postcss.parse(readFileSync(join(__dirname, '..', 'globals.css'), 'utf8'));
const PHONE = '(max-width: 767.98px)';

/** Declarations of every rule whose selector list includes this selector, keyed by the enclosing @media params ('' at top level). */
function decls(selector: string) {
  const found: Record<string, Record<string, string>> = {};
  css.walkRules((rule: Rule) => {
    if (!rule.selectors.includes(selector)) return;
    const media = rule.parent?.type === 'atrule' ? (rule.parent as { params: string }).params : '';
    rule.walkDecls((d) => { (found[media] ??= {})[d.prop] = d.value; });
  });
  return found;
}

describe('floating phone tab bar (nav at the bottom)', () => {
  it('keeps the bar box but paints nothing and lets taps through around the surfaces', () => {
    const bar = decls(':root[data-nav-position="bottom"] .app-tab-bar')[PHONE];
    expect(bar).toMatchObject({
      background: 'transparent',
      'border-width': '0',
      'backdrop-filter': 'none',
      'pointer-events': 'none',
      'padding-left': 'calc(0.5rem + env(safe-area-inset-left, 0px))',
      'padding-right': 'calc(0.5rem + env(safe-area-inset-right, 0px))',
      'padding-bottom': 'var(--tab-bar-foot)',
    });
  });

  it('draws the tabs and Search as two rounded, tappable surfaces, with Search a round icon the bar height beside the tabs', () => {
    expect(decls(':root[data-nav-position="bottom"] .app-tab-surface')[PHONE]).toMatchObject({
      'pointer-events': 'auto',
      'border-radius': '9999px',
    });
    expect(decls(':root[data-nav-position="bottom"] .app-tab-row')[PHONE]).toMatchObject({ height: 'var(--tab-bar-height)' });
    expect(decls(':root[data-nav-position="bottom"] .app-tab-search')[PHONE]).toMatchObject({
      flex: 'none',
      width: 'var(--tab-bar-height)',
      height: 'var(--tab-bar-height)',
      'margin-left': '0.5rem',
      'margin-right': '0',
    });
    expect(decls(':root[data-nav-position="bottom"] .app-tab-search-label')[PHONE]).toMatchObject({ display: 'none' });
  });

  it('with the nav at the top, lets the tab group give way so Search is one more slot in the row', () => {
    expect(decls(':root:not([data-nav-position="bottom"]) .app-tab-group')['']).toMatchObject({ display: 'contents' });
    expect(decls(':root:not([data-nav-position="bottom"]) .app-tab-row')['']).toMatchObject({ 'padding-inline': '0.375rem' });
  });

  it('reserves the same foot the bar sits on for everything that clears it', () => {
    const root = decls(':root[data-nav-position="bottom"]')[PHONE];
    // Tall enough for a tab's count to sit inside the bar's top edge.
    expect(root['--tab-bar-height']).toBe('3.5rem');
    expect(root['--tab-bar-foot']).toBe('max(env(safe-area-inset-bottom, 0px), 0.5rem)');
    expect(root['--footer-height']).toBe('calc(var(--tab-bar-height) + var(--tab-bar-foot))');
    expect(root['--footer-bar-bottom']).toBe('calc(var(--tab-bar-height) + var(--tab-bar-foot))');
  });

  it('gives the bar its surface and taps back while a full-width bar rests on it', () => {
    const backed = ':root[data-nav-position="bottom"]:has([data-now-playing-bar], [data-footer-bar]) .app-tab-bar';
    expect(decls(backed)[PHONE]).toMatchObject({
      background: 'color-mix(in oklab, var(--background) 95%, transparent)',
      'pointer-events': 'auto',
    });
    expect(decls("html[data-glass][data-nav-position='bottom']:has([data-now-playing-bar], [data-footer-bar]) .app-tab-bar")['']['background'])
      .toBe('var(--hpr-glass-bg)');
  });

  it('gives the surfaces the Liquid Glass material, and the opaque fallback where glass cannot frost', () => {
    const selector = "html[data-glass][data-nav-position='bottom'] .app-tab-surface";
    const found = decls(selector);
    expect(found['']).toMatchObject({ background: 'var(--hpr-glass-bg)', 'border-color': 'var(--hpr-glass-border)' });
    expect(found['(prefers-reduced-transparency: reduce)']).toMatchObject({ background: 'var(--hpr-surface)', 'backdrop-filter': 'none' });
    const unsupported = Object.keys(found).find((media) => media.startsWith('not'));
    expect(unsupported && found[unsupported]).toMatchObject({ background: 'var(--hpr-surface)', 'backdrop-filter': 'none' });
  });
});
