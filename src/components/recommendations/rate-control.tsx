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

export interface RateTriggerProps {
  label: string;
  rating: Rating | null;
  open: boolean;
  onClick: () => void;
}

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
  renderTrigger,
}: {
  itemKey: string | null;
  title: string;
  genres?: string[];
  lazy?: boolean;
  renderTrigger: (props: RateTriggerProps) => React.ReactNode;
}) {
  const canRate = useCan('recommendations.view');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ratingKey(itemKey ?? ''),
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/recommendations/rating?itemKey=${encodeURIComponent(itemKey!)}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()) as { rating: Rating | null }).rating;
    },
    enabled: canRate && itemKey !== null && (!lazy || open),
    staleTime: 60_000,
  });

  const mutation = useMutation({
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
      const previous = queryClient.getQueryData<Rating | null>(key);
      queryClient.setQueryData(key, rating);
      return { previous };
    },
    onError: (_error, _rating, context) => {
      queryClient.setQueryData(ratingKey(itemKey!), context?.previous ?? null);
      toast.error("Couldn't save your rating.");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recommendations'], refetchType: 'none' });
    },
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!canRate || itemKey === null) return null;
  const rating = query.data ?? null;
  const current = OPTIONS.find((option) => option.rating === rating);

  return (
    <span ref={rootRef} className="relative inline-flex">
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
          className="absolute bottom-full left-1/2 z-30 mb-2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#232323] px-2 py-1.5 shadow-lg ring-1 ring-white/15"
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
                setOpen(false);
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
