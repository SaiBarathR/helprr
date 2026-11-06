import { describe, expect, it } from 'vitest';
import { columnsFor } from './video-list';

describe('columnsFor', () => {
  it('shows one video across on a phone', () => {
    expect(columnsFor(375)).toBe(1);
    expect(columnsFor(430)).toBe(1);
  });

  it('never squeezes more than two into a tablet column', () => {
    expect(columnsFor(548)).toBe(2);
    expect(columnsFor(1100)).toBe(2);
  });

  it('adds a column only when every tile stays at least 360px wide', () => {
    expect(columnsFor(1168)).toBe(3); // a 1440px laptop beside the sidebar
    expect(columnsFor(1456)).toBe(3); // a 1728px laptop: YouTube's three, not six
    expect(columnsFor(1600)).toBe(4);
    expect(columnsFor(5000)).toBe(6);
  });
});
