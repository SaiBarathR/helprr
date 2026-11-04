/**
 * The steps of the admin's setup checklist (what to do after the first sign-in),
 * shared by the server (src/lib/setup-checklist.ts) and the dashboard card. No
 * database access here, so client code can import it.
 */
export const SETUP_STEPS = ['service', 'people', 'push', 'install', 'backup'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** Steps the admin can mark done (or skip) themselves: the server cannot see them. */
export const MANUAL_SETUP_STEPS: ReadonlySet<SetupStep> = new Set(['people', 'install', 'backup']);

/** Optional steps do not hold the checklist open. */
export const OPTIONAL_SETUP_STEPS: ReadonlySet<SetupStep> = new Set(['people']);

export interface SetupChecklistState {
  /** Hidden for good: dismissed, or every required step is done. */
  hidden: boolean;
  done: Record<SetupStep, boolean>;
}

export function isSetupStep(value: unknown): value is SetupStep {
  return typeof value === 'string' && (SETUP_STEPS as readonly string[]).includes(value);
}
