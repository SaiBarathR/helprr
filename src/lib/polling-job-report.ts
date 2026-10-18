import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * What a polling job reports about its own run beyond whether it threw: many
 * jobs log a failure and carry on (one bad instance must not stop the rest), and
 * throttled jobs return early when not due. The polling service runs each job
 * inside its report and reads it for the health view. A module of its own, so
 * code the jobs call (scheduled alerts) can report without importing the service.
 */
export interface JobReport { failure: string | null; skipped: boolean }

export const jobReports = new AsyncLocalStorage<JobReport>();

/** A job that logs an error and carries on still failed this cycle. */
export function noteJobFailure(error: unknown): void {
  const report = jobReports.getStore();
  if (report && report.failure === null) report.failure = error instanceof Error ? error.message : String(error);
}

/** A throttled job with nothing due this cycle: neither a success nor a failure. */
export function noteJobSkipped(): void {
  const report = jobReports.getStore();
  if (report) report.skipped = true;
}
