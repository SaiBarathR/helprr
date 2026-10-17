// Per-section limits for a settings import, checked before any database work,
// for sections the import would otherwise work through entry by entry. They
// mirror limits the app has enforced since the data existed, so no export of a
// real install is refused. Sections the app does not cap (watchlists, alerts,
// anime mappings, users, rules) are bounded by the document limits (bytes,
// array entries, object properties), and the import writes them in bulk so a
// document at those limits still commits in seconds
// (settings-import.integration.test.ts).

import { MAX_LAYOUTS } from '@/lib/dashboard-layouts';
import type { ImportRequestBody } from './shared';

export const IMPORT_SECTION_LIMITS = {
  // The app refuses a layout beyond this many per scope (global, or one user).
  dashboardLayouts: MAX_LAYOUTS,
  // One preference per event type and device; room for event types a newer
  // build might add.
  notificationRules: 100,
} as const;

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

/** The first section over its limit, as a message for the operator, or null. */
export function validateImportSectionLimits(body: ImportRequestBody): string | null {
  try {
    cap('notificationRules', field(body.notificationDevice, 'rules'), 'Notification rules');
    cap('dashboardLayouts', field(body.dashboardLayouts, 'layouts'), 'Dashboard layouts');
    for (const account of list(field(body.users, 'accounts'))) {
      cap('dashboardLayouts', field(account, 'dashboardLayouts'), "One user's dashboard layouts");
    }
    return null;
  } catch (error) {
    if (error instanceof SectionLimitError) return error.message;
    throw error;
  }
}
