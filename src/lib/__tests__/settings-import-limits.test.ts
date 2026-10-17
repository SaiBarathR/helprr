import { describe, expect, it } from 'vitest';
import { IMPORT_SECTION_LIMITS, validateImportSectionLimits } from '@/lib/settings-import/limits';

const over = (limit: number) => Array.from({ length: limit + 1 }, () => ({}));
const at = (limit: number) => Array.from({ length: limit }, () => ({}));
const L = IMPORT_SECTION_LIMITS;

describe('settings import section limits', () => {
  it('accepts every section at its limit', () => {
    expect(validateImportSectionLimits({
      serviceConnections: at(L.serviceConnections),
      notificationDevice: { deviceName: 'd', rules: at(L.notificationRules) },
      cleanup: { stallRules: at(L.cleanupRules), slowRules: at(L.cleanupRules), seedingRules: [{ categories: at(L.ruleListValues) }] },
      dashboardLayouts: { layouts: [{ widgets: at(L.widgetsPerLayout) }], defaultDesktopLayoutName: null, defaultMobileLayoutName: null },
      watchlist: { items: [{ tags: at(L.tagsPerItem) }], tags: at(L.watchlistTags) },
      scheduledAlerts: { alerts: at(L.scheduledAlerts) },
      animeMappings: { mappings: [{ entries: at(L.entriesPerMapping) }] },
      users: { accounts: [{ watchlist: { items: at(L.watchlistItems) }, scheduledAlerts: at(L.scheduledAlerts) }] },
    } as never)).toBeNull();
  });

  it('ignores sections that are absent or not arrays', () => {
    expect(validateImportSectionLimits({})).toBeNull();
    expect(validateImportSectionLimits({ watchlist: { items: 'x' }, users: { accounts: [null, 3] } } as never)).toBeNull();
  });

  it.each([
    [{ serviceConnections: over(L.serviceConnections) }, 'Service connections exceed the import limit of 50'],
    [{ notificationDevice: { rules: over(L.notificationRules) } }, 'Notification rules exceed the import limit of 100'],
    [{ cleanup: { slowRules: over(L.cleanupRules) } }, 'Slow rules exceed the import limit of 100'],
    [{ cleanup: { seedingRules: [{ trackerPatterns: over(L.ruleListValues) }] } }, "Values in one cleanup rule's trackerPatterns exceed the import limit of 100"],
    [{ dashboardLayouts: { layouts: over(L.dashboardLayouts) } }, 'The dashboard layouts exceed the import limit of 20'],
    [{ dashboardLayouts: { layouts: [{ widgets: over(L.widgetsPerLayout) }] } }, 'Widgets in one of the dashboard layouts exceed the import limit of 200'],
    [{ watchlist: { items: over(L.watchlistItems) } }, 'The watchlist items exceed the import limit of 5000'],
    [{ watchlist: { items: [{ tags: over(L.tagsPerItem) }] } }, 'Tags on one of the watchlist items exceed the import limit of 50'],
    [{ scheduledAlerts: { alerts: over(L.scheduledAlerts) } }, 'Scheduled alerts exceed the import limit of 2000'],
    [{ animeMappings: { mappings: over(L.animeMappings) } }, 'Anime mappings exceed the import limit of 5000'],
    [{ animeMappings: { mappings: [{ entries: over(L.entriesPerMapping) }] } }, 'Entries in one anime mapping exceed the import limit of 50'],
    [{ users: { accounts: over(L.users) } }, 'User accounts exceed the import limit of 200'],
    [{ users: { accounts: [{ watchlist: { tags: over(L.watchlistTags) } }] } }, "One user's watchlist tags exceed the import limit of 500"],
    [{ users: { accounts: [{ scheduledAlerts: over(L.scheduledAlerts) }] } }, "One user's scheduled alerts exceed the import limit of 2000"],
    [{ users: { accounts: [{ dashboardLayouts: over(L.dashboardLayouts) }] } }, "One user's dashboard layouts exceed the import limit of 20"],
  ])('names the section over its limit %#', (body, message) => {
    expect(validateImportSectionLimits(body as never)).toBe(message);
  });
});
