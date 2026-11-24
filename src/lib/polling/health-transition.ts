// When a health poll (Sonarr, Radarr, Prowlarr) sends "Health Warning" or
// "Health Restored", and which hash it stores.
import crypto from 'crypto';
import { redactHealthMessage } from '@/lib/arr-health';
import { arrHealthHref } from '@/lib/arr-health-link';
import { instanceTitle, notifyAndLog } from './shared';

/** The stored hash of an empty health list: every poller hashes JSON.stringify of a list. */
export const EMPTY_HEALTH_HASH = crypto.createHash('md5').update('[]').digest('hex');

// How long health must stay clear before "Health Restored". Until then the
// stored hash keeps the list with issues, so a check that clears and comes
// back inside it (a download client or indexer blip) sends nothing at all,
// neither the restored push nor a second warning. In memory on purpose, like
// the reachability delay: after a restart the wait starts again, which only
// delays the push.
export const HEALTH_CLEAR_HOLD_MS = 2 * 60 * 1000;
const clearSince = new Map<string, number>();

/** For tests: forget the pending all-clears. */
export function resetHealthTracking(): void {
  clearSince.clear();
}

export interface HealthDecision {
  notify: 'warning' | 'restored' | null;
  /** The hash to store for this cycle. */
  save: string;
}

/**
 * The first poll of an instance only records a baseline. A changed, non-empty
 * list is a warning, as before. An empty list after one with issues is a
 * restore once it has lasted HEALTH_CLEAR_HOLD_MS; a caller that could not
 * record the restore keeps the old hash and the next cycle tries again.
 */
export function healthTransition(
  id: string,
  lastHash: string | null,
  hash: string,
  issueCount: number,
  now = Date.now(),
): HealthDecision {
  if (issueCount > 0 || !lastHash || lastHash === EMPTY_HEALTH_HASH) {
    clearSince.delete(id);
    return { notify: lastHash && hash !== lastHash && issueCount > 0 ? 'warning' : null, save: hash };
  }
  const since = clearSince.get(id) ?? now;
  if (now - since < HEALTH_CLEAR_HOLD_MS) {
    clearSince.set(id, since);
    return { notify: null, save: lastHash };
  }
  // Left set until the empty hash is stored (the next cycle clears it), so a
  // restore that could not be recorded is retried without a new wait.
  clearSince.set(id, since);
  return { notify: 'restored', save: hash };
}

/**
 * Sonarr's and Radarr's health pushes for one instance; returns the hash to
 * store. Both open that instance's health sheet on Settings → Service status.
 */
export async function notifyArrHealth(args: {
  service: 'sonarr' | 'radarr';
  instanceId: string;
  instanceLabel: string;
  instanceCount: number;
  state: { lastHealthHash: string | null; updatedAt: Date };
  health: Array<{ message?: unknown }>;
  healthHash: string;
}): Promise<string> {
  const { service, instanceId, instanceLabel, instanceCount, state, health, healthHash } = args;
  const decision = healthTransition(instanceId, state.lastHealthHash, healthHash, health.length);
  if (!decision.notify) return decision.save;

  const name = service === 'sonarr' ? 'Sonarr' : 'Radarr';
  const url = arrHealthHref(service, instanceId);
  const metadata = { source: service, instanceId, redirect: url };
  if (decision.notify === 'warning') {
    await notifyAndLog({
      eventType: 'healthWarning',
      title: instanceTitle(`${name} Health Warning`, instanceLabel, instanceCount),
      body: health.map((h) => redactHealthMessage(h.message)).join('; ').slice(0, 200),
      url,
      metadata,
    }, { service, instanceId, reason: 'health-changed', healthCount: health.length });
    return decision.save;
  }
  const sent = await notifyAndLog({
    eventType: 'healthRestored',
    title: instanceTitle(`${name} Health Restored`, instanceLabel, instanceCount),
    body: 'All health checks pass again',
    url,
    metadata,
    // updatedAt moves whenever the poller saves its state, so a cycle whose
    // save failed repeats this key and the history row stops a second push.
    dedupeKey: `${service}-health-restored:${instanceId}:${state.updatedAt.toISOString()}`,
  }, { service, instanceId, reason: 'health-restored' });
  // Not recorded (null): keep the old hash so the next cycle tries again.
  return sent === null ? state.lastHealthHash ?? decision.save : decision.save;
}
