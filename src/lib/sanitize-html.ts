import DOMPurify from 'dompurify';

/**
 * HTML made safe for `dangerouslySetInnerHTML`.
 *
 * Browser only, and empty on the server. DOMPurify needs a DOM. The pages that
 * use this are client components whose data arrives after mount, so the server
 * never has anything to sanitise for them; it only has to be able to load the
 * module. Giving it a DOM there (jsdom, through `isomorphic-dompurify`) made
 * every server render of those pages throw, because the standalone build does
 * not contain the stylesheet jsdom reads when it loads.
 */
export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') return '';
  return DOMPurify.sanitize(html);
}
