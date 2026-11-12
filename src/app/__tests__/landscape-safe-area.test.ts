import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

// The landscape-iPhone layout lives in globals.css, which jsdom cannot lay out
// (and no browser here can emulate a notch), so this pins the CSS contract.
const css = postcss.parse(readFileSync(join(__dirname, '..', 'globals.css'), 'utf8'));

/** Declarations of every rule with exactly this selector, keyed by the enclosing @media params ('' at top level). */
function decls(selector: string) {
  const found: Record<string, Record<string, string>> = {};
  css.walkRules((rule: Rule) => {
    if (rule.selector !== selector) return;
    const media = rule.parent?.type === 'atrule' ? (rule.parent as { params: string }).params : '';
    rule.walkDecls((d) => { (found[media] ??= {})[d.prop] = d.value; });
  });
  return found;
}

describe('landscape safe areas', () => {
  it('pads <main> by the side insets outside --main-pad-x, so bleeds still cancel exactly --main-pad-x', () => {
    const main = decls('.app-main')[''];
    expect(main['padding-left']).toBe('calc(var(--main-pad-x) + var(--main-inset-left))');
    expect(main['padding-right']).toBe('calc(var(--main-pad-x) + var(--main-inset-right))');
    for (const bleed of ['.page-toolbar', '.page-bleed', '.rail-bleed']) {
      expect(decls(bleed)['']['margin-inline']).toBe('calc(-1 * var(--main-pad-x))');
    }
  });

  it('lets the sidebar own the left inset at md+, and hands it back when the cinematic skin hides the sidebar', () => {
    const root = decls(':root');
    expect(root['']['--main-inset-left']).toBe('env(safe-area-inset-left, 0px)');
    expect(root['']['--main-inset-right']).toBe('env(safe-area-inset-right, 0px)');
    expect(root['(min-width: 768px)']['--main-inset-left']).toBe('0px');
    expect(decls("html[data-watch-skin='cinematic']:has(.hpr-watch)")['']['--main-inset-left'])
      .toBe('env(safe-area-inset-left, 0px)');
  });

  it('keeps the phone tab bar off both side insets', () => {
    const bar = decls('.app-tab-bar')[''];
    expect(bar['padding-left']).toBe('env(safe-area-inset-left, 0px)');
    expect(bar['padding-right']).toBe('env(safe-area-inset-right, 0px)');
  });

  it('shrinks the top padding on a short (landscape phone) viewport', () => {
    expect(decls(':root')['(min-width: 768px) and (max-height: 500px)']['--main-pad-top']).toBe('0.5rem');
  });

  // .page-toolbar already spans main's padding; a bleed wrapper around a
  // detail page's header runs the bar past the content into the right inset.
  it('keeps the series and movie detail headers out of a bleed wrapper', () => {
    for (const page of ['series/[id]/page.tsx', 'movies/[id]/page.tsx']) {
      const src = readFileSync(join(__dirname, '..', '(app)', page), 'utf8');
      const main = src.slice(src.lastIndexOf('<PageHeader'));
      const before = src.slice(0, src.length - main.length);
      const open = before.slice(before.lastIndexOf('return ('));
      expect(open, page).not.toMatch(/-mx-/);
    }
  });
});
