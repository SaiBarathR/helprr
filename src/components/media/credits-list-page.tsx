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

const ROW_HEIGHT = 76;

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
        <PageHeader title={mediaTitle} subtitle="Cast & Crew" />
        <PageSpinner />
      </div>
    );
  }

  return (
    <div className="animate-content-in">
      <PageHeader title={mediaTitle} subtitle="Cast & Crew" />

      <div className="py-3 flex items-center gap-1">
        {(['cast', 'crew'] as const).map((t) => {
          const count = t === 'cast' ? cast.length : crew.length;
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative px-3 py-2 inline-flex items-center gap-1.5 transition-colors ${
                active ? 'text-foreground' : 'text-muted-foreground/70 hover:text-foreground'
              }`}
            >
              <span className="font-display text-[15px] capitalize" style={{ letterSpacing: '-0.01em' }}>
                {t}
              </span>
              <span className="font-mono tabular text-[10px] text-muted-foreground/65">
                · {count}
              </span>
              <span
                aria-hidden
                className={`absolute left-2 right-2 -bottom-px h-px transition-all ${
                  active ? 'bg-[color:var(--amber)] opacity-100' : 'bg-foreground/20 opacity-0'
                }`}
              />
            </button>
          );
        })}
      </div>
      <div className="hairline" aria-hidden />

      {error ? (
        <div
          className="mt-4 p-8 border border-[color:var(--hairline)] bg-card/40 text-center text-sm text-destructive"
          style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
        >
          {error}
        </div>
      ) : items.length === 0 ? (
        <div
          className="mt-4 p-10 border border-[color:var(--hairline)] bg-card/40 text-center"
          style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
        >
          <p className="tracked-caps text-[10px] text-muted-foreground">No {tab} credits</p>
          <p className="font-display text-[18px] mt-2">Empty roll.</p>
        </div>
      ) : (
        <div
          ref={handleListRef}
          className="relative w-full mt-2"
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
