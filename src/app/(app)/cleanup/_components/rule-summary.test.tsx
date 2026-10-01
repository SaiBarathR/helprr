// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SeedingRuleShape } from '@/lib/cleanup/types';
import { SeedingRuleSummary } from './rule-summary';

let root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); });

const RULE: SeedingRuleShape = {
  id: 'r1',
  isSystem: false,
  name: 'Seeding rule',
  enabled: false,
  priority: 0,
  categories: ['sonarr', 'anime-radar', 'anime-sonarr', 'lidarr', 'prowlarr', 'radarr', 'tv-sonarr'],
  trackerPatterns: [],
  tagsAny: [],
  tagsAll: [],
  privacyType: 'both',
  maxRatio: 1.5,
  minSeedTimeHours: 0,
  maxSeedTimeHours: 1,
  deleteSourceFiles: true,
  requireImportedConfirmation: true,
};

// jsdom has no layout, so this pins the declarations that keep a long chip (a
// many-category list) inside a phone-width card: it may not grow past its row
// and its text wraps instead of running off the edge.
describe('rule summary chips', () => {
  it('wraps a long category list inside the card', async () => {
    await act(async () => root.render(<SeedingRuleSummary rule={RULE} />));
    const chip = [...document.querySelectorAll('[data-slot="badge"]')]
      .find((el) => el.textContent === RULE.categories.join(', '))!;
    expect(chip.className).toContain('max-w-full');
    expect(chip.className).toContain('whitespace-normal');
    expect(chip.className).not.toContain('whitespace-nowrap');
  });
});
