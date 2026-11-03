const MAX_BYTES = 64 * 1024;
const COOKIE_FIELDS = 7;
const DOMAIN = /^(?:#HttpOnly_)?\.?(?:[\w-]+\.)*(?:youtube\.com|google\.(?:com|[a-z]{2}|com?\.[a-z]{2}))$/i;
const SIGNED_IN = ['SID', '__Secure-1PSID', '__Secure-3PSID', 'LOGIN_INFO'];

/**
 * Keeps only YouTube and Google cookies, so an export of a whole browser leaves nothing else
 * behind, and proves it is a signed-in session. Error messages never repeat the file.
 */
export function cleanCookiesFile(text: string): { cookies: string } | { error: string } {
  if (Buffer.byteLength(text) > MAX_BYTES) return { error: 'That file is too large. Export only youtube.com.' };
  const rows = text.split(/\r?\n/).map((line) => line.split('\t')).filter((fields) => fields.length === COOKIE_FIELDS);
  if (rows.length === 0) return { error: 'That is not a cookies.txt export.' };
  const kept = rows.filter(([domain]) => DOMAIN.test(domain));
  if (!kept.some(([domain]) => /youtube\.com$/i.test(domain))) return { error: 'That export has no youtube.com cookies.' };
  if (!kept.some(([, , , , , name]) => SIGNED_IN.includes(name))) return { error: 'That export is not signed in to a Google account.' };
  return { cookies: `# Netscape HTTP Cookie File\n${kept.map((fields) => fields.join('\t')).join('\n')}\n` };
}
