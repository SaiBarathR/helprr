import { useEffect } from 'react';

const PROPERTY = '--page-toolbar-bottom';
// A bar under the toolbar that toasts must not cover while it is on screen,
// such as the Torrents selection bar: it scrolls with the page, so its bottom
// is read on scroll too.
const CLEARANCE = 'main [data-toast-clearance]';

/**
 * The clearance bar's bottom while its bottom edge shows on top: not scrolled
 * under the toolbar, nor under a sheet opened over the page (toasts then belong
 * on the sheet's rows as before). Toasts themselves don't hide it.
 */
function clearanceBottom(bar: HTMLElement): number | null {
  if (bar.offsetHeight === 0) return null;
  const rect = bar.getBoundingClientRect();
  if (typeof document.elementsFromPoint !== 'function') return rect.bottom;
  const top = document.elementsFromPoint(rect.left + rect.width / 2, rect.bottom - 2)
    .find((el) => !el.closest('[data-sonner-toaster]'));
  return top && bar.contains(top) ? rect.bottom : null;
}

/**
 * Keeps `--page-toolbar-bottom` on <html> at where the page's sticky toolbar
 * ends once stuck (its pinned top plus its height), so phone toasts come in
 * just below it. A fixed one-row allowance covered the second row of taller
 * toolbars: Calendar's ‹ › Today row, the Movies/Series/Music search row.
 * Unset when the page has no toolbar, so the caller's fallback applies.
 *
 * The last visible one counts: a flow opened in a page (Interactive Search,
 * Manage Files) pins its own bar under the page header's.
 *
 * A `[data-toast-clearance]` bar below it (the Torrents selection bar) pushes
 * toasts below itself while it shows under the toolbar; once it scrolls up
 * under the toolbar, or a sheet opens over it, the toolbar counts again.
 *
 * Cheap while a toolbar is up: DOM changes are ignored unless it leaves the
 * page or another toolbar or clearance bar arrives, its size is watched by a
 * ResizeObserver, and scrolling and other DOM changes are followed only while
 * a clearance bar is up.
 */
export function usePageToolbarBottom(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    let toolbar: HTMLElement | null = null;
    let clearance: HTMLElement | null = null;
    let frameId: number | null = null;

    const resizeObserver = new ResizeObserver(() => schedule());
    const measure = () => {
      frameId = null;
      const next = [...document.querySelectorAll<HTMLElement>('main .page-toolbar')]
        .filter((el) => el.offsetHeight > 0)
        .at(-1) ?? null;
      if (next !== toolbar) {
        if (toolbar) resizeObserver.unobserve(toolbar);
        toolbar = next;
        if (toolbar) resizeObserver.observe(toolbar);
      }
      const nextClearance = document.querySelector<HTMLElement>(CLEARANCE);
      if (nextClearance !== clearance) {
        if (clearance) resizeObserver.unobserve(clearance);
        clearance = nextClearance;
        if (clearance) resizeObserver.observe(clearance);
      }
      if (!toolbar) {
        root.style.removeProperty(PROPERTY);
        return;
      }
      const stuckTop = parseFloat(getComputedStyle(toolbar).top) || 0;
      let bottom = stuckTop + toolbar.offsetHeight;
      const barBottom = clearance ? clearanceBottom(clearance) : null;
      if (barBottom !== null) bottom = Math.max(bottom, barBottom);
      root.style.setProperty(PROPERTY, `${Math.round(bottom)}px`);
    };
    function schedule() {
      if (frameId === null) frameId = requestAnimationFrame(measure);
    }

    // A new page brings a new toolbar (or none); a flow adds one under it.
    const watched = '.page-toolbar, [data-toast-clearance]';
    const addsToolbar = (node: Node) =>
      node instanceof HTMLElement && (node.matches(watched) || node.querySelector(watched) !== null);
    // While a clearance bar is up any change can cover or uncover it (a sheet
    // opening over the page); measuring is one hit test, once a frame at most.
    const mutationObserver = new MutationObserver((mutations) => {
      if (!toolbar?.isConnected || clearance || mutations.some((m) => [...m.addedNodes].some(addsToolbar))) {
        schedule();
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    // Moving the nav to the top or bottom moves where the toolbar pins.
    const navObserver = new MutationObserver(() => schedule());
    navObserver.observe(root, { attributes: true, attributeFilter: ['data-nav-position'] });
    window.addEventListener('resize', schedule);
    // Capture: the page may scroll in an element rather than the window.
    const onScroll = () => { if (clearance) schedule(); };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    measure();

    return () => {
      mutationObserver.disconnect();
      navObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (frameId !== null) cancelAnimationFrame(frameId);
      root.style.removeProperty(PROPERTY);
    };
  }, [enabled]);
}
