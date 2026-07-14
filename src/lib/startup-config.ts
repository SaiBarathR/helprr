import {
  StartupConfigurationError,
  validateRuntimeConfig,
} from '@/lib/runtime-config';

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Next.js catches errors thrown by the instrumentation hook and can leave the
 * server listening while every request returns 500. A permanent configuration
 * failure must instead stop the process so Docker/systemd can report a failed
 * start and the operator sees one redacted remediation message.
 *
 * Keep this Node-only wrapper separate from runtime-config.ts: JWT validation
 * is also imported by middleware, where process.exit is unavailable.
 */
export function validateRuntimeConfigOrExit(env: RuntimeEnvironment = process.env): void {
  try {
    validateRuntimeConfig(env);
  } catch (error) {
    const message =
      error instanceof StartupConfigurationError
        ? error.message
        : 'Startup configuration validation failed unexpectedly. Secret values were not logged.';
    console.error(`[Helprr] ${message}`);
    process.exit(1);
  }
}
