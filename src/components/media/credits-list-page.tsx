'use no memo';
'use client';

import { useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { PageHeader } from '@/components/layout/page-header';
import { PersonRow } from '@/components/media/person-row';
import { Skeleton } from '@/components/ui/skeleton';
import type { ImageServiceHint } from '@/lib/image';

export interface CreditPerson {
  id: number;
  name: string;
  imagePath: string | null;
  role: string;
  department?: string;
  episodeCount?: number;
}

interface CreditsListPageProps {
  mediaTitle: string;
  cast: CreditPerson[];
  crew: CreditPerson[];
  cacheService: ImageServiceHint;
  loading?: boolean;
  initialTab?: 'cast' | 'crew';
}

const ROW_HEIGHT = 72;

export function CreditsListPage({
  mediaTitle,
  cast,
  crew,
  cacheService,
  loading,
  initialTab = 'cast',
}: CreditsListPageProps) {
  const [tab, setTab] = useState<'cast' | 'crew'>(initialTab);
  const listRef = useRef<HTMLDivElement>(null);

  const items = tab === 'cast' ? cast : crew;

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-11 w-full" />
        <div className="px-4 flex gap-2">
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
        </div>
        <div className="px-4 space-y-1">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3">
              <Skeleton className="h-12 w-12 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={mediaTitle} />

      <div className="px-4 py-2 flex items-center gap-2">
        {(['cast', 'crew'] as const).map((t) => {
          const count = t === 'cast' ? cast.length : crew.length;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize ${
                tab === t
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-accent/50 text-muted-foreground'
              }`}
            >
              {t} ({count})
            </button>
          );
        })}
      </div>

      {items.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No {tab} credits found
        </div>
      ) : (
        <div
          ref={listRef}
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const person = items[virtualItem.index];
            return (
              <div
                key={`${person.id}-${person.role}-${virtualItem.index}`}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{
                  transform: `translateY(${virtualItem.start - (virtualizer.options.scrollMargin ?? 0)}px)`,
                }}
              >
                <PersonRow
                  id={person.id}
                  name={person.name}
                  imagePath={person.imagePath}
                  role={person.role}
                  department={person.department}
                  episodeCount={person.episodeCount}
                  cacheService={cacheService}
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="pb-8" />
    </div>
  );
}
