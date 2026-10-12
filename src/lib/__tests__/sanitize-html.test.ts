// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '@/lib/sanitize-html';

// AniList descriptions are HTML written by anyone with an account, and five
// detail pages put them on the page with dangerouslySetInnerHTML.
describe('sanitizeHtml in the browser', () => {
  it('keeps ordinary markup', () => {
    expect(sanitizeHtml('A <b>bold</b> claim.<br><i>Really.</i>')).toBe('A <b>bold</b> claim.<br><i>Really.</i>');
  });

  it.each([
    ['a script element', '<p>hi</p><script>alert(1)</script>', '<p>hi</p>'],
    ['an event handler', '<img src="x" onerror="alert(1)">', '<img src="x">'],
    ['a javascript: link', '<a href="javascript:alert(1)">x</a>', '<a>x</a>'],
    ['an iframe', 'before<iframe src="https://example.com"></iframe>after', 'beforeafter'],
  ])('removes %s', (_label, dirty, clean) => {
    expect(sanitizeHtml(dirty)).toBe(clean);
  });

  it('keeps the spoiler placeholder the character page writes', () => {
    const placeholder = '<em style="color: var(--muted-foreground); opacity: 0.6;">[Spoiler — click to reveal]</em>';
    expect(sanitizeHtml(placeholder)).toContain('[Spoiler — click to reveal]');
    expect(sanitizeHtml(placeholder)).toMatch(/^<em/);
  });
});
