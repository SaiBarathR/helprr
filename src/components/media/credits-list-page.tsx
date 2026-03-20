'use no memo';
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { PageHeader } from '@/components/layout/page-header';
import { PersonRow } from '@/components/media/person-row';
import { PageSpinner } from '@/components/ui/page-spinner';
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
  error?: string | null;
}

const ROW_HEIGHT = 72;

export function CreditsListPage({
  mediaTitle,
  cast,
  crew,
  cacheService,
  loading,
  initialTab = 'cast',
  error = null,
}: CreditsListPageProps) {
  const [tab, setTab] = useState<'cast' | 'crew'>(initialTab);
  const [scrollMargin, setScrollMargin] = useState(0);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const handleListRef = useCallback((node: HTMLDivElement | null) => {
    setScrollMargin(node?.offsetTop ?? 0);
  }, []);

  const items = tab === 'cast' ? cast : crew;

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin,
  });

  if (loading) {
    return (
      <div>
        <PageHeader title={mediaTitle} />
        <PageSpinner />
      </div>
    );
  }

  return (
    <div className="animate-content-in">
      <PageHeader title={mediaTitle} />

      <div className="py-2 flex items-center gap-2">
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

      {error ? (
        <div className="py-12 text-center text-sm text-destructive">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No {tab} credits found
        </div>
      ) : (
        <div
          ref={handleListRef}
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
