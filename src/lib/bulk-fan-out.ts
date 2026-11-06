import { toast } from 'sonner';
import { ApiError } from '@/lib/query-fetch';
import { handleAuthError } from '@/lib/query-client';

export interface BulkFanOutResult {
  ok: number;
  fail: number;
  firstError?: string;
  /** Instances whose whole request failed, so a retry can target only those groups. */
  failedInstanceIds: (string | undefined)[];
}

async function parseErrorFromResponse(res: Response): Promise<string | undefined> {
  try {
    const data = await res.json();
    return typeof data?.error === 'string' ? data.error : undefined;
  } catch {
    return undefined;
  }
}

/** Count successes/failures from a response body when the API returns per-item tallies. */
export type BulkCountParser = (
  res: Response,
  ids: number[],
) => Promise<{ ok: number; fail: number } | null>;

export async function bulkFanOut(
  groups: Iterable<[string | undefined, number[]]>,
  run: (instanceId: string | undefined, ids: number[]) => Promise<Response>,
  opts?: { countResult?: BulkCountParser },
): Promise<BulkFanOutResult> {
  let ok = 0;
  let fail = 0;
  let firstError: string | undefined;
  const failedInstanceIds: (string | undefined)[] = [];

  await Promise.all([...groups].map(async ([instanceId, ids]) => {
    try {
      const res = await run(instanceId, ids);
      if (res.status === 401) handleAuthError(new ApiError(401, 'Session expired'));

      if (res.ok && opts?.countResult) {
        const tallies = await opts.countResult(res, ids);
        if (tallies) {
          ok += tallies.ok;
          fail += tallies.fail;
          if (tallies.fail > 0 && !firstError) firstError = 'Some items failed';
          return;
        }
      }

      if (res.ok) ok += ids.length;
      else {
        fail += ids.length;
        failedInstanceIds.push(instanceId);
        if (!firstError) firstError = await parseErrorFromResponse(res);
      }
    } catch (e) {
      handleAuthError(e);
      fail += ids.length;
      failedInstanceIds.push(instanceId);
      if (!firstError && e instanceof Error) firstError = e.message;
    }
  }));

  return { ok, fail, firstError, failedInstanceIds };
}

export function reportBulk(
  verb: string,
  ok: number,
  fail: number,
  opts?: { noun?: string; pluralNoun?: string; reason?: string },
) {
  const singular = opts?.noun ?? 'item';
  const plural = opts?.pluralNoun ?? `${singular}s`;
  const word = ok === 1 ? singular : plural;
  const reasonSuffix = fail && opts?.reason ? `: ${opts.reason}` : '';
  if (fail) toast.error(`${verb} ${ok} ${word}, ${fail} failed${reasonSuffix}`);
  else toast.success(`${verb} ${ok} ${word}`);
}

export function reportBulkTorrent(verb: string, ok: number, fail: number) {
  const word = ok + fail === 1 ? 'torrent' : 'torrents';
  if (fail && !ok) toast.error(`Failed to ${verb.toLowerCase()} ${fail} ${word}`);
  else if (fail) toast.error(`${verb} ${ok} ${word}, ${fail} failed`);
  else toast.success(`${verb} ${ok} ${word}`);
}

export async function parseSeriesSearchTallies(
  res: Response,
): Promise<{ ok: number; fail: number } | null> {
  try {
    const data = await res.json();
    if (typeof data?.ok === 'number' && typeof data?.fail === 'number') {
      return { ok: data.ok, fail: data.fail };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * The items whose instance request succeeded. After a partial failure, deselecting these
 * leaves only the failed groups selected, so a retry doesn't repeat a change (or a file
 * move) on instances where it already worked.
 */
export function itemsOnSucceededInstances<T extends { instanceId?: string }>(
  items: T[],
  failedInstanceIds: (string | undefined)[],
): T[] {
  const failed = new Set(failedInstanceIds);
  return items.filter((item) => !failed.has(item.instanceId));
}
