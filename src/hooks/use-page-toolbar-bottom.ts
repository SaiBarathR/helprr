import { useEffect } from 'react';

const PROPERTY = '--page-toolbar-bottom';

/**
 * Keeps `--page-toolbar-bottom` on <html> at where the page's sticky toolbar
 * ends once stuck (its pinned top plus its height), so phone toasts come in
 * just below it. A fixed one-row allowance covered the second row of taller
 * toolbars: Calendar's ‹ › Today row, the Movies/Series/Music search row.
 * Unset when the page has no toolbar, so the caller's fallback applies.
 *
 * Cheap while a toolbar is up: DOM changes are ignored until it leaves the
 * page, and its size is watched by a ResizeObserver.
 */
export function usePageToolbarBottom(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    let toolbar: HTMLElement | null = null;
    let frameId: number | null = null;

    const resizeObserver = new ResizeObserver(() => schedule());
    const measure = () => {
      frameId = null;
      const next = document.querySelector<HTMLElement>('main .page-toolbar');
      if (next !== toolbar) {
        if (toolbar) resizeObserver.unobserve(toolbar);
        toolbar = next;
        if (toolbar) resizeObserver.observe(toolbar);
      }
      if (!toolbar || toolbar.offsetHeight === 0) {
        root.style.removeProperty(PROPERTY);
        return;
      }
      const stuckTop = parseFloat(getComputedStyle(toolbar).top) || 0;
      root.style.setProperty(PROPERTY, `${Math.round(stuckTop + toolbar.offsetHeight)}px`);
    };
    function schedule() {
      if (frameId === null) frameId = requestAnimationFrame(measure);
    }

    // A new page brings a new toolbar (or none).
    const mutationObserver = new MutationObserver(() => {
      if (!toolbar?.isConnected) schedule();
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    // Moving the nav to the top or bottom moves where the toolbar pins.
    const navObserver = new MutationObserver(() => schedule());
    navObserver.observe(root, { attributes: true, attributeFilter: ['data-nav-position'] });
    window.addEventListener('resize', schedule);
    measure();

    return () => {
      mutationObserver.disconnect();
      navObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', schedule);
      if (frameId !== null) cancelAnimationFrame(frameId);
      root.style.removeProperty(PROPERTY);
    };
  }, [enabled]);
}
