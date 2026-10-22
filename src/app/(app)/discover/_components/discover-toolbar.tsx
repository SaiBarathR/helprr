'use client';

import { useEffect, useRef } from 'react';
import { isFreshArrival, readRouteScrollState, routeScrollKey } from '@/lib/route-scroll-state';
import { SearchBar } from '@/components/media/search-bar';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Check, Compass, Film, Filter, Tv } from 'lucide-react';
import { SORT_OPTIONS, formatWait, type RateLimitInfo } from './discover-data';
import type { DiscoverView } from './link-view';

/** Discover's toolbar: search, content type, advanced filters, the sort pills, and the TMDB rate-limit banner. */
export function DiscoverToolbar({
  searchParamsKey,
  query,
  handleQueryChange,
  discoverContentType,
  handleSelectContentType,
  handleOpenFilters,
  activeAdvancedFilterCount,
  discoverSort,
  handleSelectSort,
  rateLimitInfo,
  rateLimitCountdown,
}: {
  searchParamsKey: string;
  query: string;
  handleQueryChange: (value: string) => void;
  discoverContentType: DiscoverView['contentType'];
  handleSelectContentType: (type: 'all' | 'movie' | 'show') => void;
  handleOpenFilters: () => void;
  activeAdvancedFilterCount: number;
  discoverSort: string;
  handleSelectSort: (sort: string) => void;
  rateLimitInfo: RateLimitInfo | null;
  rateLimitCountdown: number | null;
}) {
  const sortRowRef = useRef<HTMLDivElement>(null);
  const selectedSortRef = useRef<HTMLButtonElement>(null);
  const arrivedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // On arriving at a URL by Back/Forward or reload, the row's saved offset
    // wins; a fresh link, and any later sort change, reveal the selection.
    const arriving = arrivedKeyRef.current !== searchParamsKey;
    arrivedKeyRef.current = searchParamsKey;
    if (arriving && !isFreshArrival() && readRouteScrollState(routeScrollKey(window.location))?.elements['named:discover-sort']) return;
    const row = sortRowRef.current;
    const selected = selectedSortRef.current;
    if (!row || !selected) return;
    // The row bleeds to the screen edge; keep the page's padding around the chip.
    const style = getComputedStyle(row);
    const bounds = row.getBoundingClientRect();
    const left = bounds.left + (parseFloat(style.scrollPaddingLeft) || 0);
    const right = bounds.right - (parseFloat(style.scrollPaddingRight) || 0);
    const chip = selected.getBoundingClientRect();
    if (chip.right > right) row.scrollLeft += chip.right - right;
    else if (chip.left < left) row.scrollLeft += chip.left - left;
  }, [searchParamsKey, discoverSort]);

  return (
    <div className="page-toolbar page-toolbar-flush pb-2 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <SearchBar
            // A fresh box per Discover URL: carried across, the old box's
            // empty text is written over the text the new URL remembers.
            key={searchParamsKey}
            value={query}
            onChange={handleQueryChange}
            placeholder="Search movies and shows"
            historyKey="discover"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Content type"
            className="h-10 w-10 rounded-lg border border-border/60 flex items-center justify-center"
          >
            {discoverContentType === 'movie' ? (
              <Film className="h-4 w-4" />
            ) : discoverContentType === 'show' ? (
              <Tv className="h-4 w-4" />
            ) : (
              <Compass className="h-4 w-4" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            {[
              { value: 'all', label: 'All', icon: Compass },
              { value: 'movie', label: 'Movies', icon: Film },
              { value: 'show', label: 'Shows', icon: Tv },
            ].map((option) => {
              const Icon = option.icon;
              const active = discoverContentType === option.value;
              return (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() => handleSelectContentType(option.value as 'all' | 'movie' | 'show')}
                  className={active ? 'text-primary font-semibold' : ''}
                >
                  <Icon className="h-4 w-4" />
                  {option.label}
                  {active && <Check className="h-3.5 w-3.5 ml-auto" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          onClick={handleOpenFilters}
          className="relative h-10 w-10 rounded-lg border border-border/60 flex items-center justify-center"
          aria-label="Advanced filters"
        >
          <Filter className="h-4 w-4" />
          {activeAdvancedFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
              {activeAdvancedFilterCount > 9 ? '9+' : activeAdvancedFilterCount}
            </span>
          )}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {/* <p className="text-[11px] font-medium text-muted-foreground">Sort</p> */}
        <div ref={sortRowRef} data-scroll-restoration-key="discover-sort" className="rail-bleed flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {SORT_OPTIONS.map((option) => {
            const active = discoverSort === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                ref={active ? selectedSortRef : undefined}
                onClick={() => handleSelectSort(option.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5 ${
                  active ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-accent/40 text-muted-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {rateLimitInfo && (
        <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">TMDB rate limit reached</p>
          <p className="text-xs text-amber-800/90 dark:text-amber-200/90">
            {rateLimitCountdown != null
              ? `Please wait ${formatWait(rateLimitCountdown)} before retrying.`
              : rateLimitInfo.retryAt
                ? `Please retry around ${new Date(rateLimitInfo.retryAt).toLocaleTimeString()}.`
                : `${rateLimitInfo.message}. Please wait and try again.`}
          </p>
        </div>
      )}
    </div>
  );
}
