export type DetailViewKey =
  | `anime:${string | number}`
  | `manga:${string | number}`
  | `movie:${string | number}`
  | `series:${string | number}`
  | `artist:${string | number}`
  | `album:${string | number}`;

export interface DetailViewState {
  scrollY: number;
  updatedAt: number;
}

const viewCache: Partial<Record<DetailViewKey, DetailViewState>> = {};

function isBrowser() {
  return typeof window !== 'undefined';
}

function storageKey(key: DetailViewKey) {
  return `helprr:detail-view:${key}`;
}

export function getDetailViewState(key: DetailViewKey): DetailViewState | null {
  const inMemory = viewCache[key];
  if (inMemory) return inMemory;
  if (!isBrowser()) return null;

  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DetailViewState>;
    if (typeof parsed.scrollY !== 'number') return null;

    const restored: DetailViewState = {
      scrollY: parsed.scrollY,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
    viewCache[key] = restored;
    return restored;
  } catch {
    return null;
  }
}

export function setDetailViewState(key: DetailViewKey, next: Omit<DetailViewState, 'updatedAt'>) {
  const value: DetailViewState = {
    ...next,
    updatedAt: Date.now(),
  };

  viewCache[key] = value;
  if (!isBrowser()) return;

  try {
    sessionStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // Ignore quota/security errors.
  }
}

export function waitForScrollY(targetScrollY: number, timeoutMs = 1200, pollMs = 50): Promise<void> {
  return new Promise((resolve) => {
    if (!isBrowser()) {
      resolve();
      return;
    }

    const startedAt = Date.now();
    const tick = () => {
      const maxScroll = Math.max(
        0,
        (document.scrollingElement?.scrollHeight ??
          document.documentElement.scrollHeight ??
          document.body.scrollHeight) - window.innerHeight
      );
      if (maxScroll >= targetScrollY || Date.now() - startedAt >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, pollMs);
    };
    tick();
  });
}
