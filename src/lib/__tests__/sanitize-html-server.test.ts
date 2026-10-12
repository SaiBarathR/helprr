import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '@/lib/sanitize-html';

// This file runs without a DOM, as the server does.
describe('sanitizeHtml on the server', () => {
  it('loads without a DOM and returns nothing rather than unsanitised HTML', () => {
    expect(typeof window).toBe('undefined');
    expect(sanitizeHtml('<img src="x" onerror="alert(1)">')).toBe('');
  });

  // jsdom on the server is what broke the server render of these pages: the
  // standalone build does not carry the stylesheet it reads when it loads.
  it('does not depend on a package that loads jsdom at run time', () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).not.toContain('isomorphic-dompurify');
    expect(Object.keys(pkg.dependencies)).not.toContain('jsdom');
    expect(Object.keys(pkg.dependencies)).toContain('dompurify');
  });
});
