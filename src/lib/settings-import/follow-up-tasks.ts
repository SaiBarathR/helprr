// The runtime steps that follow a settings import, shared by the server
// (follow-ups.ts) and the import dialog. Kept free of server imports so the
// browser bundle can use it.

export const IMPORT_FOLLOW_UPS = [
  'appSettings',
  'imageCachePurge',
  'pollingRestart',
  'cleanupStrikePrune',
  'cleanupSchedulers',
  'alertOccurrences',
  'dashboardLayoutCache',
  'defaultInstances',
] as const;
export type ImportFollowUp = (typeof IMPORT_FOLLOW_UPS)[number];

export function isImportFollowUp(value: unknown): value is ImportFollowUp {
  return typeof value === 'string' && (IMPORT_FOLLOW_UPS as readonly string[]).includes(value);
}

export interface ImportWarning {
  task: ImportFollowUp;
  message: string;
  /** For alertOccurrences: the alerts still without occurrences, to retry by id. */
  alertIds?: string[];
}
