export const NAVIGATION_START_EVENT = 'helprr:navigation-start';
export const NAVIGATION_CANCEL_EVENT = 'helprr:navigation-cancel';

export type NavigationStartDetail = {
  kind: 'push' | 'replace' | 'traverse';
  href?: string;
  preserveScroll?: boolean;
};

export interface ScrollPoint { top: number; left: number }
export interface RouteScrollState {
  document: ScrollPoint;
  elements: Record<string, ScrollPoint>;
  updatedAt: number;
}

const STORAGE_PREFIX = 'helprr:route-scroll:';
const MAX_ROUTES = 50;
const WRITE_DELAY_MS = 250;
const SCROLLABLE_SELECTOR = [
  '[data-scroll-restoration-key]', '[style*="overflow"]', '[data-radix-scroll-area-viewport]',
  '[class*="overflow-x-auto"]', '[class*="overflow-y-auto"]', '[class*="overflow-auto"]',
  '[class*="overflow-x-scroll"]', '[class*="overflow-y-scroll"]', '[class*="overflow-scroll"]',
].join(',');

const memory = new Map<string, RouteScrollState>();
const writeTimers = new Map<string, number>();

export function routeScrollKey(location: Pick<Location, 'pathname' | 'search'>): string {
  const params = new URLSearchParams(location.search);
  params.sort();
  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ''}`;
}

function storageKey(routeKey: string) { return `${STORAGE_PREFIX}${routeKey}`; }

function validState(parsed: Partial<RouteScrollState> | null): parsed is RouteScrollState {
  return Boolean(parsed
    && typeof parsed.document?.top === 'number'
    && typeof parsed.document.left === 'number'
    && parsed.elements && typeof parsed.elements === 'object');
}

function trimMemory() {
  if (memory.size <= MAX_ROUTES) return;
  const oldest = [...memory.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  for (const [key] of oldest.slice(0, memory.size - MAX_ROUTES)) memory.delete(key);
}

export function readRouteScrollState(routeKey: string): RouteScrollState | null {
  const cached = memory.get(routeKey);
  if (cached) return cached;
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey(routeKey)) ?? 'null') as Partial<RouteScrollState> | null;
    if (!validState(parsed)) return null;
    memory.set(routeKey, parsed);
    trimMemory();
    return parsed;
  } catch { return null; }
}

function persist(routeKey: string) {
  const value = memory.get(routeKey);
  if (!value || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(storageKey(routeKey), JSON.stringify(value));
    const stored = Object.keys(sessionStorage)
      .filter((key) => key.startsWith(STORAGE_PREFIX))
      .map((key) => {
        try {
          const value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Partial<RouteScrollState> | null;
          return { key, updatedAt: value?.updatedAt ?? 0 };
        } catch { return { key, updatedAt: 0 }; }
      })
      .sort((a, b) => a.updatedAt - b.updatedAt);
    for (const entry of stored.slice(0, Math.max(0, stored.length - MAX_ROUTES))) sessionStorage.removeItem(entry.key);
  } catch {
    // Storage restrictions and quota failures must not affect navigation.
  }
}

export function writeRouteScrollState(routeKey: string, state: Omit<RouteScrollState, 'updatedAt'>) {
  memory.set(routeKey, { ...state, updatedAt: Date.now() });
  trimMemory();
  if (typeof window === 'undefined') return;
  const current = writeTimers.get(routeKey);
  if (current) window.clearTimeout(current);
  writeTimers.set(routeKey, window.setTimeout(() => {
    writeTimers.delete(routeKey);
    persist(routeKey);
  }, WRITE_DELAY_MS));
}

export function flushRouteScrollState(routeKey: string) {
  const timer = writeTimers.get(routeKey);
  if (timer && typeof window !== 'undefined') window.clearTimeout(timer);
  writeTimers.delete(routeKey);
  persist(routeKey);
}

function safeToken(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function structuralKey(root: HTMLElement, element: HTMLElement): string {
  const labelled = element.getAttribute('aria-label');
  if (labelled) return `label:${safeToken(labelled)}`;
  const widget = element.closest<HTMLElement>('[data-widget-id]');
  if (widget && widget !== root) return `widget:${widget.dataset.widgetId}:${structuralKey(widget, element)}`;
  const section = element.closest('section');
  const heading = section?.querySelector<HTMLElement>('h1,h2,h3,[role="heading"]')?.textContent;
  if (heading) return `section:${safeToken(heading)}`;
  const parts: string[] = [];
  let node: HTMLElement | null = element;
  while (node && node !== root && parts.length < 6) {
    if (node.id) { parts.unshift(`#${safeToken(node.id)}`); break; }
    const parent: HTMLElement | null = node.parentElement;
    const siblings = parent ? [...parent.children].filter((candidate) => candidate.tagName === node!.tagName) : [];
    const stable = node.getAttribute('data-testid') ?? node.getAttribute('role');
    parts.unshift(`${node.tagName.toLowerCase()}${stable ? `:${safeToken(stable)}` : ''}:${siblings.indexOf(node)}`);
    node = parent;
  }
  return `path:${parts.join('/')}`;
}

export function collectRestorableElements(root: HTMLElement): Map<string, HTMLElement> {
  const result = new Map<string, HTMLElement>();
  const collisions = new Map<string, number>();
  for (const element of root.querySelectorAll<HTMLElement>(SCROLLABLE_SELECTOR)) {
    if (element.closest('[data-scroll-restoration-ignore]')) continue;
    if (!element.dataset.scrollRestorationKey
      && element.scrollWidth <= element.clientWidth
      && element.scrollHeight <= element.clientHeight) continue;
    const base = element.dataset.scrollRestorationKey
      ? `named:${element.dataset.scrollRestorationKey}`
      : structuralKey(root, element);
    const collision = collisions.get(base) ?? 0;
    collisions.set(base, collision + 1);
    result.set(collision ? `${base}:${collision}` : base, element);
  }
  return result;
}

export function captureRouteScroll(root: HTMLElement): Omit<RouteScrollState, 'updatedAt'> {
  const elements: Record<string, ScrollPoint> = {};
  for (const [key, element] of collectRestorableElements(root)) {
    elements[key] = { top: element.scrollTop, left: element.scrollLeft };
  }
  return { document: { top: window.scrollY, left: window.scrollX }, elements };
}

export function applyRouteScroll(root: HTMLElement, state: Omit<RouteScrollState, 'updatedAt'>): boolean {
  const scrollingElement = document.scrollingElement ?? document.documentElement;
  const maxTop = Math.max(0, scrollingElement.scrollHeight - window.innerHeight);
  const maxLeft = Math.max(0, scrollingElement.scrollWidth - window.innerWidth);
  // Let the browser clamp: scrollHeight/clientHeight are integer-rounded,
  // while valid native scroll offsets can include fractional CSS pixels.
  window.scrollTo({ top: state.document.top, left: state.document.left, behavior: 'instant' });
  let complete = maxTop + 1 >= state.document.top && maxLeft + 1 >= state.document.left;
  const current = collectRestorableElements(root);
  for (const [key, point] of Object.entries(state.elements)) {
    const element = current.get(key);
    if (!element) {
      if (point.top !== 0 || point.left !== 0) complete = false;
      continue;
    }
    const elementMaxTop = Math.max(0, element.scrollHeight - element.clientHeight);
    const elementMaxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    const top = point.top;
    const left = point.left;
    if (typeof element.scrollTo === 'function') element.scrollTo({ top, left, behavior: 'instant' });
    else { element.scrollTop = top; element.scrollLeft = left; }
    if (elementMaxTop + 1 < point.top || elementMaxLeft + 1 < point.left) complete = false;
  }
  return complete;
}

export function isScrollIntent(event: Event): boolean {
  if (event.type === 'wheel' || event.type === 'touchmove') return true;
  if (event.type === 'keydown') {
    const keyboard = event as KeyboardEvent;
    if (keyboard.altKey || keyboard.ctrlKey || keyboard.metaKey || keyboard.shiftKey) return false;
    const target = keyboard.target as HTMLElement | null;
    if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return false;
    return ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(keyboard.key);
  }
  if (event.type === 'pointerdown') {
    const pointer = event as PointerEvent;
    const target = pointer.target;
    if (!(target instanceof HTMLElement)) return false;
    // Explicit controls (pagination, filters, anchors) take ownership too.
    if (target.closest('button, a, input, select, textarea, [role="button"], [role="tab"]')) return true;
    const rect = target.getBoundingClientRect();
    return (target.scrollHeight > target.clientHeight && pointer.clientX >= rect.left + target.clientWidth)
      || (target.scrollWidth > target.clientWidth && pointer.clientY >= rect.top + target.clientHeight);
  }
  return false;
}

export function clearRouteScrollStateForTests() {
  for (const timer of writeTimers.values()) if (typeof window !== 'undefined') window.clearTimeout(timer);
  writeTimers.clear();
  memory.clear();
}
