'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { Clock, Film, Heart, Star, Tv, X } from 'lucide-react';
import { FadeInImage } from '@/components/media/fade-in-image';
import { haptic } from '@/lib/haptics';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { TonightTitle } from '@/types/tonight';

/** Drag distance that counts as a vote. */
export const SWIPE_COMMIT_PX = 96;
const ENGAGE_PX = 8;
const FLY_OUT_MS = 180;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * One title to vote on: drag right for yes, left for no, or use the buttons
 * (or the arrow keys, wired by the parent). The finger-following transform is
 * written straight to the DOM so a drag never re-renders the card. With reduced
 * motion the card does not tilt or fly away; the vote just lands.
 */
export function TonightSwipeCard({
  title,
  onVote,
  disabled = false,
}: {
  title: TonightTitle;
  onVote: (yes: boolean) => void;
  disabled?: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const yesStampRef = useRef<HTMLSpanElement>(null);
  const noStampRef = useRef<HTMLSpanElement>(null);
  const startRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const engagedRef = useRef(false);
  const dxRef = useRef(0);
  const [leaving, setLeaving] = useState(false);

  const poster = title.posterUrl
    ? toCachedImageSrc(title.posterUrl, title.mediaType === 'movie' ? 'radarr' : 'sonarr') ?? title.posterUrl
    : null;

  function paint(dx: number, animate: boolean) {
    dxRef.current = dx;
    const card = cardRef.current;
    if (card) {
      const tilt = reducedMotion() ? 0 : dx / 20;
      card.style.transition = animate && !reducedMotion() ? `transform ${FLY_OUT_MS}ms ease-out` : 'none';
      card.style.transform = dx === 0 ? '' : `translateX(${dx}px) rotate(${tilt}deg)`;
    }
    const strength = Math.min(1, Math.abs(dx) / SWIPE_COMMIT_PX);
    if (yesStampRef.current) yesStampRef.current.style.opacity = dx > 0 ? String(strength) : '0';
    if (noStampRef.current) noStampRef.current.style.opacity = dx < 0 ? String(strength) : '0';
  }

  function vote(yes: boolean) {
    if (disabled || leaving) return;
    haptic(yes ? 'success' : 'light');
    if (reducedMotion()) {
      onVote(yes);
      return;
    }
    setLeaving(true);
    const width = cardRef.current?.offsetWidth || 320;
    paint((yes ? 1 : -1) * (width + 160), true);
    window.setTimeout(() => onVote(yes), FLY_OUT_MS);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (disabled || leaving || (e.pointerType === 'mouse' && e.button !== 0)) return;
    startRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    engagedRef.current = false;
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const start = startRef.current;
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!engagedRef.current) {
      if (Math.abs(dx) < ENGAGE_PX) return;
      // A mostly vertical move is a scroll of the overview, not a vote.
      if (Math.abs(dy) > Math.abs(dx)) {
        startRef.current = null;
        return;
      }
      engagedRef.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    paint(dx, false);
  }

  function onPointerEnd(e: PointerEvent<HTMLDivElement>) {
    const start = startRef.current;
    startRef.current = null;
    if (!start || start.id !== e.pointerId || !engagedRef.current) return;
    engagedRef.current = false;
    const dx = dxRef.current;
    if (e.type === 'pointerup' && Math.abs(dx) >= SWIPE_COMMIT_PX) vote(dx > 0);
    else paint(0, true);
  }

  const MediaIcon = title.mediaType === 'movie' ? Film : Tv;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div
        ref={cardRef}
        data-testid="tonight-card"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        className="relative mx-auto flex min-h-0 w-full max-w-sm flex-1 select-none flex-col overflow-hidden rounded-2xl bg-card shadow-[0_24px_60px_-20px_rgba(0,0,0,0.75)] ring-1 ring-border [touch-action:pan-y]"
      >
        <div className="relative min-h-0 flex-1 bg-muted">
          {poster ? (
            <FadeInImage
              src={poster}
              alt=""
              fill
              sizes="(min-width: 640px) 384px, 100vw"
              className="object-cover"
              draggable={false}
              unoptimized={isProtectedApiImageSrc(poster)}
              priority
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              <MediaIcon className="h-14 w-14" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />
          <span
            ref={yesStampRef}
            aria-hidden
            className="tracked-caps absolute left-4 top-4 -rotate-12 rounded-md border-2 border-primary px-2 py-1 text-lg text-primary opacity-0"
          >
            Yes
          </span>
          <span
            ref={noStampRef}
            aria-hidden
            className="tracked-caps absolute right-4 top-4 rotate-12 rounded-md border-2 border-muted-foreground px-2 py-1 text-lg text-muted-foreground opacity-0"
          >
            Nope
          </span>
        </div>
        <div className="space-y-2 p-4">
          <h2 className="text-xl font-semibold leading-tight">{title.title}</h2>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {title.year !== null && <span>{title.year}</span>}
            {title.runtime !== null && title.runtime > 0 && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {title.runtime}m
              </span>
            )}
            {title.rating !== null && title.rating > 0 && (
              <span className="inline-flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                {title.rating.toFixed(1)}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <MediaIcon className="h-3.5 w-3.5" />
              {title.mediaType === 'movie' ? 'Movie' : 'Series'}
            </span>
          </div>
          {title.genres.length > 0 && (
            <p className="truncate text-xs text-muted-foreground">{title.genres.slice(0, 4).join(' · ')}</p>
          )}
          {title.overview && (
            <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{title.overview}</p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-8">
        <button
          type="button"
          onClick={() => vote(false)}
          disabled={disabled || leaving}
          aria-label={`Not tonight: ${title.title}`}
          className="press-feedback inline-flex h-14 w-14 items-center justify-center rounded-full border border-border bg-card text-muted-foreground disabled:opacity-50"
        >
          <X className="h-6 w-6" />
        </button>
        <button
          type="button"
          onClick={() => vote(true)}
          disabled={disabled || leaving}
          aria-label={`Yes, watch ${title.title}`}
          className="press-feedback projector-glow inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
        >
          <Heart className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
