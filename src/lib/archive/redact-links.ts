// A backslash ends a link too, so a link inside JSON text keeps the string's escapes intact.
const LINK = /https?:\/\/[^\s"'<>\])\\]+/g;

/**
 * Links that yt-dlp and ffmpeg print can be signed. YouTube's media links carry the signature
 * in the path as well as the query, and Twitch's in the query. Errors and job events keep the
 * host and path for diagnosis, and never the signature.
 */
export function withoutSignedLinks(text: string): string {
  return text.replace(LINK, (match) => {
    // A sentence's full stop is not part of the link.
    const tail = /[.,;:!?]+$/.exec(match)?.[0] ?? '';
    const link = match.slice(0, match.length - tail.length);
    try {
      const url = new URL(link);
      if (url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com')) return `[YouTube media link removed]${tail}`;
      return `${url.search ? `${url.origin}${url.pathname}?[removed]` : link}${tail}`;
    } catch {
      return `[link removed]${tail}`;
    }
  });
}
