// Per-section limits for a settings import, checked before any database work.
// The global limits (bytes, array entries, object properties) bound the
// document; these bound each section to what an export of a real install can
// hold, with room to spare, so no one section can turn the import's single
// transaction into minutes of row writes.

import { MAX_LAYOUTS, MAX_WIDGETS_PER_LAYOUT } from '@/lib/dashboard-layouts';
import type { ImportRequestBody } from './shared';

export const IMPORT_SECTION_LIMITS = {
  serviceConnections: 50,
  notificationRules: 100,
  cleanupRules: 100, // each of stall, slow and seeding rules
  ruleListValues: 100, // categories, tracker patterns or tags of one rule
  dashboardLayouts: MAX_LAYOUTS, // global, and per user
  widgetsPerLayout: MAX_WIDGETS_PER_LAYOUT,
  watchlistItems: 5_000, // per user
  watchlistTags: 500, // per user
  tagsPerItem: 50,
  scheduledAlerts: 2_000, // per user
  animeMappings: 5_000,
  entriesPerMapping: 50,
  users: 200,
} as const;

const RULE_LISTS = ['categories', 'trackerPatterns', 'tagsAny', 'tagsAll'];

class SectionLimitError extends Error {}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

function cap(limit: keyof typeof IMPORT_SECTION_LIMITS, value: unknown, what: string): void {
  if (list(value).length > IMPORT_SECTION_LIMITS[limit]) {
    throw new SectionLimitError(`${what} exceed the import limit of ${IMPORT_SECTION_LIMITS[limit]}`);
  }
}

function checkWatchlist(watchlist: unknown, owner: string): void {
  cap('watchlistItems', field(watchlist, 'items'), `${owner}watchlist items`);
  cap('watchlistTags', field(watchlist, 'tags'), `${owner}watchlist tags`);
  for (const item of list(field(watchlist, 'items'))) {
    cap('tagsPerItem', field(item, 'tags'), `Tags on one of ${owner.toLowerCase()}watchlist items`);
  }
}

function checkLayouts(layouts: unknown, owner: string): void {
  cap('dashboardLayouts', layouts, `${owner}dashboard layouts`);
  for (const layout of list(layouts)) {
    cap('widgetsPerLayout', field(layout, 'widgets'), `Widgets in one of ${owner.toLowerCase()}dashboard layouts`);
  }
}

/** The first section over its limit, as a message for the operator, or null. */
export function validateImportSectionLimits(body: ImportRequestBody): string | null {
  try {
    cap('serviceConnections', body.serviceConnections, 'Service connections');
    cap('notificationRules', field(body.notificationDevice, 'rules'), 'Notification rules');
    for (const [key, what] of [['stallRules', 'Stall rules'], ['slowRules', 'Slow rules'], ['seedingRules', 'Seeding rules']]) {
      const rules = field(body.cleanup, key);
      cap('cleanupRules', rules, what);
      for (const rule of list(rules)) {
        for (const values of RULE_LISTS) cap('ruleListValues', field(rule, values), `Values in one cleanup rule's ${values}`);
      }
    }
    checkLayouts(field(body.dashboardLayouts, 'layouts'), 'The ');
    checkWatchlist(body.watchlist, 'The ');
    cap('scheduledAlerts', field(body.scheduledAlerts, 'alerts'), 'Scheduled alerts');
    const mappings = field(body.animeMappings, 'mappings');
    cap('animeMappings', mappings, 'Anime mappings');
    for (const mapping of list(mappings)) cap('entriesPerMapping', field(mapping, 'entries'), 'Entries in one anime mapping');

    const accounts = field(body.users, 'accounts');
    cap('users', accounts, 'User accounts');
    for (const account of list(accounts)) {
      checkWatchlist(field(account, 'watchlist'), "One user's ");
      cap('scheduledAlerts', field(account, 'scheduledAlerts'), "One user's scheduled alerts");
      checkLayouts(field(account, 'dashboardLayouts'), "One user's ");
    }
    return null;
  } catch (error) {
    if (error instanceof SectionLimitError) return error.message;
    throw error;
  }
}
