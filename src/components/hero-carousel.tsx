'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface HeroCarouselProps {
  slides: ReactNode[];
  className?: string;
  intervalMs?: number;
}

// Auto-advancing crossfade carousel for full-bleed hero banners. Swipe
// horizontally to change slides (vertical swipes still scroll the page);
// the dots jump straight to a slide. The container owns the height (pass
// it via className) and each slide fills it absolutely. Slides with content
// near the bottom edge should reserve ~pb-8 for the dot row.
export function HeroCarousel({ slides, className = '', intervalMs = 7000 }: HeroCarouselProps) {
  const [index, setIndex] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const count = slides.length;

  // Re-armed whenever the index changes, so manual navigation resets the clock.
  useEffect(() => {
    if (count <= 1) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % count), intervalMs);
    return () => clearTimeout(timer);
  }, [index, count, intervalMs]);

  if (count === 0) return null;

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
        swiped.current = false;
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start || count <= 1) return;
        const t = e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        // Only a mostly-horizontal swipe switches the slide; vertical movement
        // is a page scroll and small movement is a tap on the slide's link.
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
        swiped.current = true;
        setIndex((i) => (i + (dx < 0 ? 1 : -1) + count) % count);
      }}
      onClickCapture={(e) => {
        // A swipe that ends over the link must switch slides, not open the item.
        if (swiped.current) {
          e.preventDefault();
          e.stopPropagation();
          swiped.current = false;
        }
      }}
    >
      {slides.map((slide, i) => (
        <div
          key={i}
          aria-hidden={i !== index}
          className={`absolute inset-0 transition-opacity duration-700 ${
            i === index ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
          }`}
        >
          {slide}
        </div>
      ))}
      {count > 1 && (
        <div className="absolute bottom-0 inset-x-0 z-20 flex items-center justify-center pb-1">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
              className="p-2"
            >
              <span
                className={`block h-2 rounded-full transition-all ${
                  i === index ? 'w-6 bg-foreground' : 'w-2 bg-foreground/50'
                }`}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
