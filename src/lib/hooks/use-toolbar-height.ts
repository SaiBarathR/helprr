'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * Measures a page's sticky toolbar and exposes its height as
 * --page-toolbar-height, which DataTable's sticky header sits under. Until the
 * first measurement the table keeps its own fallback offset.
 */
export function useToolbarHeight() {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const measure = () => setToolbarHeight(toolbar.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar, { box: 'border-box' });
    return () => observer.disconnect();
  }, []);

  const toolbarStyle = toolbarHeight > 0
    ? ({ '--page-toolbar-height': `${toolbarHeight}px` } as CSSProperties)
    : undefined;
  return { toolbarRef, toolbarStyle };
}
