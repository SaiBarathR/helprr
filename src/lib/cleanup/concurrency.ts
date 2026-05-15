// Runs `worker` against each item with at most `limit` concurrent invocations.
// Workers handle their own try/catch and side-effects; this helper does not
// propagate errors. Order of completion is not preserved — callers that care
// must capture order inside `worker`.
export async function processWithLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        await worker(items[i]);
      }
    },
  );
  await Promise.all(runners);
}
