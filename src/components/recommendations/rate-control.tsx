'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/components/permission-provider';
import type { Rating } from '@/lib/recommendations/ratings';
import { cn } from '@/lib/utils';

const OPTIONS: Array<{ rating: Rating; label: string }> = [
  { rating: 'down', label: 'Not for me' },
  { rating: 'up', label: 'I like this' },
  { rating: 'love', label: 'Love this!' },
];

export function RatingIcon({ rating, className }: { rating: Rating | null; className?: string }) {
  if (rating === 'down') return <ThumbsDown className={cn(className, 'fill-current')} />;
  if (rating === 'love') {
    return (
      <span className="relative inline-flex" aria-hidden="true">
        <ThumbsUp className={cn(className, 'fill-current')} />
        <ThumbsUp className={cn(className, '-ml-2.5 fill-current')} />
      </span>
    );
  }
  return <ThumbsUp className={cn(className, rating === 'up' && 'fill-current')} />;
}

const ratingKey = (itemKey: string) => ['recommendations', 'rating', itemKey] as const;

async function fetchRating(itemKey: string, signal?: AbortSignal): Promise<Rating | null> {
  const res = await fetch(`/api/recommendations/rating?itemKey=${encodeURIComponent(itemKey)}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { rating: Rating | null }).rating;
}

export interface RateTriggerProps {
  label: string;
  rating: Rating | null;
  open: boolean;
  onClick: () => void;
}

/** What a rating changes: the recommendation rails and feed, the Watch rails, and the Excluded titles list. */
const AFFECTED_QUERIES = [
  ['recommendations'],
  ['recommendations-feed'],
  ['recommendations-excluded'],
  ['recommendations-excluded-count'],
  ['jellyfin', 'catalog', 'recommendation-rails'],
] as const;
/** The dashboard's For You widget, cached as `['widget-data', 'for-you-<limit>']`. */
const isForYouWidget = (query: { queryKey: readonly unknown[] }) =>
  query.queryKey[0] === 'widget-data' && String(query.queryKey[1]).startsWith('for-you');

/**
 * The Rate control: thumbs-down, thumbs-up or "Love this!", sent to the
 * recommendations engine as the user's rating of the title. The pressed state
 * is the user's latest rating, read back from the server; choosing it again
 * clears it. Each surface draws its own trigger; `lazy` (the tiles) reads the
 * rating only once the menu is opened.
 */
export function RateControl({
  itemKey,
  title,
  genres,
  lazy = false,
  placement = 'above',
  renderTrigger,
}: {
  itemKey: string | null;
  title: string;
  genres?: string[];
  lazy?: boolean;
  /** 'beside' keeps the menu inside a clipped container, such as a tile's popover. */
  placement?: 'above' | 'beside';
  renderTrigger: (props: RateTriggerProps) => React.ReactNode;
}) {
  const canRate = useCan('recommendations.view');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ratingKey(itemKey ?? ''),
    queryFn: ({ signal }) => fetchRating(itemKey!, signal),
    enabled: canRate && itemKey !== null && (!lazy || open),
    staleTime: 60_000,
  });

  const mutationKey = ['recommendations', 'rating-save', itemKey];
  const mutation = useMutation({
    mutationKey,
    // Two quick choices for one title are sent in order, never side by side.
    scope: { id: `rating:${itemKey}` },
    mutationFn: async (rating: Rating | null) => {
      const res = await fetch('/api/recommendations/rating', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemKey, rating, genres: genres?.filter((g) => g.length <= 40).slice(0, 10) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onMutate: async (rating) => {
      const key = ratingKey(itemKey!);
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData(key, rating);
    },
    onError: () => {
      toast.error("Couldn't save your rating.");
    },
    // Only once the title's last queued choice has settled: an earlier one's
    // refetch would show the server's older rating over the newer choice. The
    // refetch also puts back the saved rating after a failure.
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey }) > 1) return;
      // Read the saved rating even where the query is idle (a closed tile menu
      // is lazy), so a failed save never leaves its optimistic choice showing.
      void queryClient.fetchQuery({ queryKey: ratingKey(itemKey!), queryFn: () => fetchRating(itemKey!), staleTime: 0 }).catch(() => undefined);
      for (const queryKey of AFFECTED_QUERIES) void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ predicate: isForYouWidget });
    },
  });

  // The trigger is the first button in the control; the menu's come after it.
  const close = () => {
    setOpen(false);
    rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    (root?.querySelector<HTMLButtonElement>('[role="group"] [aria-pressed="true"]')
      ?? root?.querySelector<HTMLButtonElement>('[role="group"] button'))?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node)) setOpen(false);
    };
    // Window capture runs before the dialog's own document listener, so Escape
    // closes this menu and not the Watch overlay around it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !root?.contains(document.activeElement)) return;
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
      root?.querySelector<HTMLButtonElement>('button')?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  if (!canRate || itemKey === null) return null;
  const rating = query.data ?? null;
  const current = OPTIONS.find((option) => option.rating === rating);

  return (
    <span
      ref={rootRef}
      className="relative inline-flex"
      // Tabbing away closes the menu, so its Escape handling never outlives it.
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {renderTrigger({
        label: current ? `Rated ${title}: ${current.label}` : `Rate ${title}`,
        rating,
        open,
        onClick: () => setOpen((value) => !value),
      })}
      {open && (
        <span
          role="group"
          aria-label={`Rate ${title}`}
          className={cn(
            'absolute z-30 flex items-center gap-1 rounded-full bg-[#232323] px-2 py-1.5 shadow-lg ring-1 ring-white/15',
            placement === 'beside' ? 'left-full top-1/2 ml-2 -translate-y-1/2' : 'bottom-full left-1/2 mb-2 -translate-x-1/2',
          )}
        >
          {OPTIONS.map((option) => (
            <button
              key={option.rating}
              type="button"
              aria-label={option.label}
              title={option.label}
              aria-pressed={rating === option.rating}
              onClick={(event) => {
                // Tiles sit on a stretched link; a rating must not also navigate.
                event.preventDefault();
                event.stopPropagation();
                mutation.mutate(rating === option.rating ? null : option.rating);
                close();
              }}
              className={cn(
                'flex size-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15',
                rating === option.rating && 'bg-white/20',
              )}
            >
              <RatingIcon rating={option.rating} className="size-[18px]" />
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
