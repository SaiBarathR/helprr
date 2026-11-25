// Characters no file name may hold on Windows, macOS or Linux, and control characters.
const UNSAFE = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;
const MAX_NAME_LENGTH = 150;

/** `<torrent name>.torrent`, made safe to save; the hash when there is no usable name. */
export function torrentExportFilename(name: string | undefined, hash: string): string {
  const base = Array.from((name ?? '').replace(UNSAFE, '_').trim().replace(/^[.\s]+|[.\s]+$/g, ''))
    .slice(0, MAX_NAME_LENGTH)
    .join('')
    .trim();
  return `${base || hash.toLowerCase()}.torrent`;
}

/**
 * An attachment header carrying the name: `filename*` (RFC 6266/5987) in full,
 * and an ASCII `filename` for clients that read only that.
 */
export function torrentExportDisposition(name: string | undefined, hash: string): string {
  const filename = torrentExportFilename(name, hash);
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/[%;]/g, '_');
  // encodeURIComponent leaves ' ( ) as they are; RFC 5987 wants them encoded.
  const encoded = encodeURIComponent(filename).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** The file name a download's Content-Disposition gives (`filename*` first), or the fallback. */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // Fall through to the plain name.
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header);
  return plain?.[1] || fallback;
}
