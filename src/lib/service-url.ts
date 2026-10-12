/**
 * A service connection's URL in the form two of them are compared in.
 *
 * Shared by the server, which reuses a saved secret only for the URL it was
 * saved with, and the settings form, which has to predict that. Safe to import
 * on the client.
 */
export function normalizeServiceUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
