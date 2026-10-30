const HTTP_URL = /https?:\/\/[^\s"'<>]+/gi;

/**
 * Replaces every http(s) URL in `text` with its origin. Upstream services quote
 * the URLs they called, and an indexer can carry its API key or passkey in the
 * path as well as in the query, so nothing past the host is kept. The origin
 * never includes user:password. No imports, so client-shared modules can use it.
 */
export function urlsToOrigins(text: string): string {
  return text.replace(HTTP_URL, (match) => {
    // Punctuation after a URL in prose ("at [https://host/path]." ) is not part of it.
    const trailing = /[\])}>.,;:!?]+$/.exec(match)?.[0] ?? '';
    const url = match.slice(0, match.length - trailing.length);
    try {
      return new URL(url).origin + trailing;
    } catch {
      return `[URL]${trailing}`;
    }
  });
}
