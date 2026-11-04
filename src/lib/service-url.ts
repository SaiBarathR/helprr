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

/**
 * The URL with `http://` in front when it has no scheme, so `192.168.1.10:8989`
 * works as typed. Safe to import on the client.
 */
export function withDefaultScheme(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}
