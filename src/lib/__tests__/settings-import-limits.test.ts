import { describe, expect, it } from 'vitest';
import { MAX_LAYOUTS } from '@/lib/dashboard-layouts';
import { IMPORT_SECTION_LIMITS, validateImportSectionLimits } from '@/lib/settings-import/limits';

const items = (count: number) => Array.from({ length: count }, () => ({}));

describe('settings import section limits', () => {
  it('match the layout limit the app enforces', () => {
    expect(IMPORT_SECTION_LIMITS.dashboardLayouts).toBe(MAX_LAYOUTS);
  });

  it('accept sections at their limit, and leave uncapped sections to the document limits', () => {
    expect(validateImportSectionLimits({
      notificationDevice: { deviceName: 'd', rules: items(IMPORT_SECTION_LIMITS.notificationRules) },
      dashboardLayouts: { layouts: items(MAX_LAYOUTS), defaultDesktopLayoutName: null, defaultMobileLayoutName: null },
      // The app does not cap these, so neither may the import.
      watchlist: { items: [{ tags: items(500) }], tags: items(5_000) },
      scheduledAlerts: { alerts: items(5_000) },
      users: { accounts: [{ dashboardLayouts: items(MAX_LAYOUTS), watchlist: { items: items(5_000) } }] },
    } as never)).toBeNull();
  });

  it('ignore sections that are absent or not arrays', () => {
    expect(validateImportSectionLimits({})).toBeNull();
    expect(validateImportSectionLimits({ dashboardLayouts: { layouts: 'x' }, users: { accounts: [null, 3] } } as never)).toBeNull();
  });

  it.each([
    [{ notificationDevice: { rules: items(101) } }, 'Notification rules exceed the import limit of 100'],
    [{ dashboardLayouts: { layouts: items(MAX_LAYOUTS + 1) } }, `Dashboard layouts exceed the import limit of ${MAX_LAYOUTS}`],
    [{ users: { accounts: [{}, { dashboardLayouts: items(MAX_LAYOUTS + 1) }] } }, `One user's dashboard layouts exceed the import limit of ${MAX_LAYOUTS}`],
  ])('name the section over its limit %#', (body, message) => {
    expect(validateImportSectionLimits(body as never)).toBe(message);
  });
});
