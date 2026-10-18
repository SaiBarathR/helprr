/** Play all queues at most this many titles; a larger set is cut here. */
export const PLAY_ALL_MAX = 500;
const PLAY_ALL_PAGE = 200;

/**
 * Pages through the filtered set for Play all and Shuffle all, asking only for
 * what is still needed, up to PLAY_ALL_MAX. `total` is the size of the whole
 * set, so a caller can tell when the ceiling cut it.
 */
export async function collectForPlayAll<T>(
  fetchPage: (limit: number, startIndex: number) => Promise<{ items: T[]; total: number }>,
): Promise<{ items: T[]; total: number }> {
  const items: T[] = [];
  let total = Number.POSITIVE_INFINITY;
  while (items.length < Math.min(total, PLAY_ALL_MAX)) {
    const chunk = await fetchPage(Math.min(PLAY_ALL_PAGE, PLAY_ALL_MAX - items.length), items.length);
    total = chunk.total;
    if (chunk.items.length === 0) break;
    items.push(...chunk.items);
  }
  return { items, total: Number.isFinite(total) ? total : items.length };
}

/** The on-screen notice when the queue is shorter than the set on screen, or null. */
export function playAllNotice(queued: number, total: number, shuffle: boolean): string | null {
  if (queued === 0 || total <= queued) return null;
  return `${shuffle ? 'Shuffled' : 'Queued'} ${queued} of ${total} titles`;
}
