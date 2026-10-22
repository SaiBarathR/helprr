import { describe, expect, it } from 'vitest';
import { ALL_WIDGET_DEFINITIONS } from './definitions';

describe('Service Health widget', () => {
  it('defaults to full width and two rows on a phone, so service names fit', () => {
    const health = ALL_WIDGET_DEFINITIONS.find((w) => w.id === 'service-health')!;
    expect(health.defaultMobileSpan).toEqual({ colSpan: 2, rowSpan: 2 });
  });
});
