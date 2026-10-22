import { describe, expect, it } from 'vitest';
import { ALL_WIDGET_DEFINITIONS } from './definitions';
import { DASHBOARD_MOBILE_COLS } from './sanitize';

describe('Service Health widget', () => {
  it('spans every phone column and several rows when added, so service names fit', () => {
    const health = ALL_WIDGET_DEFINITIONS.find((w) => w.id === 'service-health')!;
    expect(health.defaultMobileSpan.colSpan).toBe(DASHBOARD_MOBILE_COLS);
    expect(health.defaultMobileSpan.rowSpan).toBeGreaterThanOrEqual(3);
  });
});
