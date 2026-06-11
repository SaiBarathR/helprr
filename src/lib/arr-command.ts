type ArrService = 'radarr' | 'sonarr' | 'lidarr';

const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 60_000;

/**
 * Poll a queued *arr command until it finishes. *arr commands are asynchronous:
 * the POST that creates them returns immediately with status `queued`, then
 * progresses through `started` to `completed`/`failed`. Callers use this to wait
 * for completion before re-fetching the affected item.
 *
 * Resolves with the terminal status string, or `'timeout'` if the command is
 * still running after POLL_TIMEOUT_MS. Never rejects — refresh is best-effort UI.
 */
export async function pollCommand(service: ArrService, id: number, instanceId?: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  // Poll the same instance the command was created on; without it the status
  // route falls back to the default instance and 404s on a non-default command.
  const url = instanceId
    ? `/api/${service}/command/${id}?instanceId=${instanceId}`
    : `/api/${service}/command/${id}`;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    try {
      const res = await fetch(url);
      // 4xx (auth, missing command) won't recover — stop instead of spinning to timeout.
      if (res.status >= 400 && res.status < 500) return 'error';
      if (!res.ok) continue; // 5xx/transient — keep polling until the deadline.
      const command = (await res.json()) as { status?: string };
      const status = command.status;
      if (status === 'completed' || status === 'failed' || status === 'aborted') {
        return status;
      }
    } catch {
      // Transient fetch error — keep polling until the deadline.
    }
  }

  return 'timeout';
}
