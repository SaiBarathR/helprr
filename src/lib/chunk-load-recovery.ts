// After a deploy, an open PWA still runs the old JS. When it lazy-loads a
// chunk the new server no longer has, React's "Try again" re-imports the same
// missing file forever; only a full reload picks up the new build.

const AUTO_RELOAD_KEY = 'helprr:chunk-reload';
const AUTO_RELOAD_WINDOW_MS = 30_000;

export function isChunkLoadError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return (
    name === 'ChunkLoadError' ||
    (typeof message === 'string' &&
      /Loading (CSS )?chunk \S+ failed|Failed to load chunk|Failed to fetch dynamically imported module|Importing a module script failed/i
        .test(message))
  );
}

// Automatic reloads run at most once per window in this tab, so a chunk that is
// really gone cannot loop (even through a redirect to another path). Without
// session storage there is no guard, so skip.
function claimAutoReload(): boolean {
  try {
    const age = Date.now() - Number(globalThis.sessionStorage.getItem(AUTO_RELOAD_KEY));
    if (age >= 0 && age < AUTO_RELOAD_WINDOW_MS) return false;
    globalThis.sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

function clearPagesAndReload(): void {
  const reload = () => globalThis.location.reload();
  if (!('caches' in globalThis)) {
    reload();
    return;
  }
  void globalThis.caches.delete('pages').then(reload, reload);
}

// navigator.onLine stays true on Wi-Fi with no route to the server. A chunk
// that failed there is not a new deploy, and wiping the saved page shells would
// lose the offline start, so an automatic reload first checks the server answers.
async function serverAnswers(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Drops the cached page shell and reloads when `error` is a chunk load failure
 * and the device is online. Returns true when a reload was started; otherwise
 * the caller shows its normal retry. Pass `automatic` when no user tapped
 * anything: that applies the reload-loop guard and reloads only once the
 * server answers.
 */
export function reloadForChunkLoadError(error: unknown, { automatic = false } = {}): boolean {
  if (!isChunkLoadError(error) || !globalThis.navigator.onLine) return false;
  if (!automatic) {
    clearPagesAndReload();
    return true;
  }
  if (!claimAutoReload()) return false;
  void serverAnswers().then((answers) => {
    if (answers) clearPagesAndReload();
  });
  return true;
}
