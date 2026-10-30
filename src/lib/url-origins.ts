// Any scheme with an authority (http, https, udp, wss...), also when written
// JSON-escaped inside a string (https:\/\/host\/path).
// The scheme length is capped so a long run of word characters cannot make
// the match retry quadratically.
const URL_WITH_AUTHORITY = /\b[a-z][a-z0-9+.-]{0,31}:(?:\/\/|\\\/\\\/)[^\s"'<>]+/gi;
const MAGNET = /magnet:\?[^\s"'<>]+/gi;
const TRAILING_PUNCTUATION = /[\])}>.,;:!?]$/;

function splitTrailingPunctuation(match: string): [string, string] {
  let end = match.length;
  const opens = match.split('[').length - 1;
  let closes = match.split(']').length - 1;
  while (end > 0 && TRAILING_PUNCTUATION.test(match[end - 1])) {
    if (match[end - 1] === ']') {
      // Keep the "]" that closes an IPv6 host: https://[2001:db8::1]
      if (opens > closes - 1) break;
      closes -= 1;
    }
    end -= 1;
  }
  return [match.slice(0, end), match.slice(end)];
}

function originOf(raw: string): string {
  const url = new URL(raw.replace(/\\\//g, '/'));
  // URL.origin is "null" for schemes the URL spec does not know (udp://...).
  return url.origin !== 'null' ? url.origin : `${url.protocol}//${url.host}`;
}

/**
 * Replaces every URL in `text` with its origin and every magnet link with
 * `magnet:[REDACTED]`. Upstream services quote the URLs they called, and an
 * indexer or tracker can carry its API key or passkey in the path as well as in
 * the query, so nothing past the host is kept. The origin never includes
 * user:password. No imports, so client-shared modules can use it.
 */
export function urlsToOrigins(text: string): string {
  return text
    .replace(MAGNET, 'magnet:[REDACTED]')
    .replace(URL_WITH_AUTHORITY, (match) => {
      const [url, trailing] = splitTrailingPunctuation(match);
      try {
        return originOf(url) + trailing;
      } catch {
        return `[URL]${trailing}`;
      }
    });
}
