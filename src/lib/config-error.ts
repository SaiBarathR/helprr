/**
 * Intentional, user-facing configuration guidance ("X is not configured.
 * Please add a connection in Settings."). upstreamErrorResponse passes these
 * messages through to the client verbatim, so only throw this for messages
 * that contain no upstream/internal detail. Lives in its own module so both
 * service clients and the API error helper can import it without cycles.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}
