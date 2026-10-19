'use client';

import type { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { MediaGridSkeleton } from '@/components/ui/media-grid-skeleton';
import { Loader2, Search, User, X } from 'lucide-react';
import type { DiscoverItem } from '@/types';
import type { DiscoverView } from './link-view';
import { MediaPoster } from './discover-cards';

const gridClassName = 'grid grid-cols-[repeat(auto-fill,minmax(122px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(138px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(154px,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2.5 sm:gap-3.5 md:gap-4';

/** Discover's browse and search results: what narrows them, the grid, and the sentinel that loads the next page. */
export function DiscoverResults({
  shownPerson,
  updateView,
  activeSectionKey,
  sortPresetNote,
  goToDiscoverHome,
  loadingItems,
  items,
  resetFilters,
  handleOpenItem,
  hasNextPage,
  sentinelRef,
  loadingMore,
}: {
  shownPerson: DiscoverView['person'];
  updateView: (patch: Partial<DiscoverView>) => void;
  activeSectionKey: string | null;
  sortPresetNote: string | null;
  goToDiscoverHome: () => void;
  loadingItems: boolean;
  items: DiscoverItem[];
  resetFilters: () => void;
  handleOpenItem: (item: DiscoverItem) => void;
  hasNextPage: boolean;
  sentinelRef: RefObject<HTMLDivElement | null>;
  loadingMore: boolean;
}) {
  return (
    <div className="space-y-3">
      {shownPerson && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <User className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium flex-1 truncate">Movies with {shownPerson.name}</span>
          <button
            onClick={() => updateView({ person: null })}
            className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Discover Results</p>
          <p className="text-xs text-muted-foreground">
            {shownPerson ? `Filtered by: ${shownPerson.name}` : activeSectionKey ? `Section: ${activeSectionKey.replaceAll('_', ' ')}` : 'Custom search and filters'}
          </p>
          {sortPresetNote && <p className="text-xs text-muted-foreground">{sortPresetNote}</p>}
        </div>
        <div className="flex items-center gap-2">
          {activeSectionKey && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => updateView({ section: null })}
              className="h-8 px-2 text-xs"
            >
              Clear section
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={goToDiscoverHome} className="h-8 px-2 text-xs">
            Back to Discover
          </Button>
        </div>
      </div>

      {loadingItems ? (
        <MediaGridSkeleton gridClassName={gridClassName} />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card p-8 text-center space-y-2">
          <Search className="h-6 w-6 mx-auto text-muted-foreground" />
          <p className="font-semibold">No matches found</p>
          <p className="text-sm text-muted-foreground">Try adjusting filters or search query.</p>
          <Button variant="outline" onClick={resetFilters}>Reset filters</Button>
        </div>
      ) : (
        <>
          <div className={gridClassName}>
            {items.map((item, i) => (
              <MediaPoster
                key={`${item.mediaType}-${item.tmdbId}`}
                item={item}
                onClick={handleOpenItem}
                variant="grid"
                imagePriority={i < 4}
              />
            ))}
          </div>

          {hasNextPage && (
            <div
              ref={sentinelRef}
              className="flex justify-center py-4"
              aria-hidden="true"
            >
              {loadingMore && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
