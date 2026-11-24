import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Edit pages give their selects a fixed width beside a label. Without
// min-w-0 a flex child can't shrink below that width, so at 320 px the trigger
// ran 16 px past the row's padding to the card's edge.
const PAGES = ['series/[id]/edit/page.tsx', 'movies/[id]/edit/page.tsx', 'music/[id]/edit/page.tsx'];

describe('Edit page select triggers', () => {
  for (const page of PAGES) {
    it(`${page}: every fixed-width trigger can shrink`, () => {
      const source = readFileSync(join(__dirname, page), 'utf8');
      const triggers = [...source.matchAll(/<SelectTrigger[^>]*className="([^"]*w-\[180px\][^"]*)"/g)].map((m) => m[1]);
      expect(triggers.length).toBeGreaterThan(0);
      for (const cls of triggers) expect(cls).toContain('min-w-0');
    });
  }
});
