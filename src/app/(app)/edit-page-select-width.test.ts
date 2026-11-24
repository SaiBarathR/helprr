import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Edit pages give their selects a fixed width beside a label. Without
// min-w-0 a flex child can't shrink below that width, so at 320 px the trigger
// ran 16 px past the row's padding to the card's edge; once it could shrink,
// the label touched it, so it keeps a 12 px margin (the row itself has no gap).
const PAGES = ['series/[id]/edit/page.tsx', 'movies/[id]/edit/page.tsx', 'music/[id]/edit/page.tsx'];

describe('Edit page select triggers', () => {
  for (const page of PAGES) {
    it(`${page}: every fixed-width trigger can shrink and keeps clear of its label`, () => {
      const source = readFileSync(join(__dirname, page), 'utf8');
      const triggers = [...source.matchAll(/<SelectTrigger[^>]*className="([^"]*w-\[180px\][^"]*)"/g)].map((m) => m[1]);
      expect(triggers.length).toBeGreaterThan(0);
      for (const cls of triggers) {
        expect(cls).toContain('min-w-0');
        expect(cls).toContain('ml-3');
      }
    });
  }
});
