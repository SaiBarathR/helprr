'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** Three lines with a Read more, offered only when the clamp really hides something. */
export function ClampedText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || open) return;
    // Fires once on observing, and again whenever a rotation rewraps the text.
    const observer = new ResizeObserver(() => setClipped(element.scrollHeight > element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, text]);

  return (
    <div>
      <p ref={ref} className={cn('text-sm leading-relaxed text-muted-foreground', !open && 'line-clamp-3', className)}>{text}</p>
      {(clipped || open) && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-sm font-medium text-primary">
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  );
}
