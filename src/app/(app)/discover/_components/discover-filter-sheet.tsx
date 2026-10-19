'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import { LanguageRegionCombobox } from '@/components/ui/language-region-combobox';
import { DEFAULT_DISCOVER_FILTERS, type DiscoverFiltersState } from '@/lib/store';
import type { DiscoverFiltersResponse } from '@/types';
import type { DiscoverView } from './link-view';
import { SORT_OPTIONS, isDefaultFilters, normalizeFilterValues } from './discover-data';

/** Discover's advanced filters: drafts edited in the sheet, applied to the view only on Apply. */
export function DiscoverFilterSheet({
  filtersOpen,
  setFiltersOpen,
  isMobile,
  draftSort,
  setDraftSort,
  draftSortDirection,
  setDraftSortDirection,
  draftFilters,
  setDraftFilters,
  filtersMeta,
  genreChoices,
  providerChoices,
  query,
  updateView,
  discoverContentType,
}: {
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean) => void;
  isMobile: boolean;
  draftSort: string;
  setDraftSort: (sort: string) => void;
  draftSortDirection: DiscoverView['sortDirection'];
  setDraftSortDirection: (direction: DiscoverView['sortDirection']) => void;
  draftFilters: DiscoverFiltersState;
  setDraftFilters: (filters: DiscoverFiltersState) => void;
  filtersMeta: DiscoverFiltersResponse | null;
  genreChoices: DiscoverFiltersResponse['genres'];
  providerChoices: DiscoverFiltersResponse['providers'];
  query: string;
  updateView: (patch: Partial<DiscoverView>) => void;
  discoverContentType: DiscoverView['contentType'];
}) {
  return (
    <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={isMobile ? 'h-[88dvh] rounded-t-2xl' : 'w-[92vw] sm:max-w-md'}
      >
        <SheetHeader>
          <SheetTitle>Advanced Filters</SheetTitle>
        </SheetHeader>

        <div className="flex-1 min-h-0 px-4 pb-4 overflow-y-auto space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Sort</label>
            <div className="grid grid-cols-2 gap-2">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setDraftSort(option.value);
                  }}
                  className={`px-3 py-2 rounded-lg border text-sm ${draftSort === option.value ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Sort Direction</label>
            <div className="grid grid-cols-2 gap-2">
              {['desc', 'asc'].map((dir) => (
                <button
                  key={dir}
                  onClick={() => setDraftSortDirection(dir as 'asc' | 'desc')}
                  className={`px-3 py-2 rounded-lg border text-sm uppercase ${draftSortDirection === dir ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
                >
                  {dir}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Year From</label>
              <Input
                value={draftFilters.yearFrom}
                onChange={(e) => setDraftFilters({ ...draftFilters, yearFrom: e.target.value })}
                placeholder="1995"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Year To</label>
              <Input
                value={draftFilters.yearTo}
                onChange={(e) => setDraftFilters({ ...draftFilters, yearTo: e.target.value })}
                placeholder="2026"
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Runtime Min</label>
              <Input
                value={draftFilters.runtimeMin}
                onChange={(e) => setDraftFilters({ ...draftFilters, runtimeMin: e.target.value })}
                placeholder="45"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Runtime Max</label>
              <Input
                value={draftFilters.runtimeMax}
                onChange={(e) => setDraftFilters({ ...draftFilters, runtimeMax: e.target.value })}
                placeholder="180"
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Rating Min</label>
              <Input
                value={draftFilters.ratingMin}
                onChange={(e) => setDraftFilters({ ...draftFilters, ratingMin: e.target.value })}
                placeholder="7.5"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Rating Max</label>
              <Input
                value={draftFilters.ratingMax}
                onChange={(e) => setDraftFilters({ ...draftFilters, ratingMax: e.target.value })}
                placeholder="10"
                inputMode="decimal"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Vote Count Min</label>
            <Input
              value={draftFilters.voteCountMin}
              onChange={(e) => setDraftFilters({ ...draftFilters, voteCountMin: e.target.value })}
              placeholder="500"
              inputMode="numeric"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Language</label>
              <LanguageRegionCombobox
                value={draftFilters.language}
                onChange={(code) => setDraftFilters({ ...draftFilters, language: code })}
                options={filtersMeta?.languages || []}
                placeholder="Any language"
                emptyLabel="Any language"
                searchPlaceholder="Search language"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Region</label>
              <LanguageRegionCombobox
                value={draftFilters.region}
                onChange={(code) => setDraftFilters({ ...draftFilters, region: code })}
                options={filtersMeta?.regions || []}
                placeholder="Any region"
                emptyLabel="Any region"
                searchPlaceholder="Search region"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Release State</label>
            <div className="grid grid-cols-2 gap-2">
              {['', 'released', 'upcoming', 'airing', 'ended'].map((state) => (
                <button
                  key={state || 'all'}
                  onClick={() => setDraftFilters({ ...draftFilters, releaseState: state as '' | 'released' | 'upcoming' | 'airing' | 'ended' })}
                  className={`px-3 py-2 rounded-lg border text-sm ${draftFilters.releaseState === state ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
                >
                  {state || 'Any'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Genres</label>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border/50 p-2">
              <div className="flex flex-wrap gap-2">
              {genreChoices.slice(0, 28).map((genre) => {
                const active = draftFilters.genres.includes(genre.id);
                return (
                  <button
                    key={`${genre.type}-${genre.id}`}
                    onClick={() => {
                      const set = new Set(draftFilters.genres);
                      if (set.has(genre.id)) set.delete(genre.id);
                      else set.add(genre.id);
                      setDraftFilters({ ...draftFilters, genres: [...set] });
                    }}
                    className={`px-2.5 py-1 rounded-full text-xs border whitespace-normal text-left leading-tight ${active ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
                  >
                    {genre.name}
                  </button>
                );
              })}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Providers</label>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border/50 p-2">
              <div className="flex flex-wrap gap-2">
              {providerChoices.slice(0, 28).map((provider) => {
                const active = draftFilters.providers.includes(provider.id);
                return (
                  <button
                    key={`${provider.type}-${provider.id}`}
                    onClick={() => {
                      const set = new Set(draftFilters.providers);
                      if (set.has(provider.id)) set.delete(provider.id);
                      else set.add(provider.id);
                      setDraftFilters({ ...draftFilters, providers: [...set] });
                    }}
                    className={`px-2.5 py-1 rounded-full text-xs border whitespace-normal text-left leading-tight ${active ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
                  >
                    {provider.name}
                  </button>
                );
              })}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Networks</label>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border/50 p-2">
              <div className="flex flex-wrap gap-2">
              {(filtersMeta?.networks || []).slice(0, 24).map((network) => {
                const active = draftFilters.networks.includes(network.id);
                return (
                  <button
                    key={network.id}
                    onClick={() => {
                      const set = new Set(draftFilters.networks);
                      if (set.has(network.id)) set.delete(network.id);
                      else set.add(network.id);
                      setDraftFilters({ ...draftFilters, networks: [...set] });
                    }}
                    className={`px-2.5 py-1 rounded-full text-xs border whitespace-normal text-left leading-tight ${active ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
                  >
                    {network.name}
                  </button>
                );
              })}
              </div>
            </div>
          </div>
        </div>

        <SheetFooter className="border-t">
          <div className="grid grid-cols-2 gap-2 w-full">
            <Button
              variant="outline"
              onClick={() => {
                setDraftFilters({ ...DEFAULT_DISCOVER_FILTERS });
                setDraftSort('trending');
                setDraftSortDirection('desc');
              }}
            >
              Reset
            </Button>
            <Button onClick={() => {
              const normalized = normalizeFilterValues(draftFilters);
              updateView({
                filters: normalized,
                sort: draftSort,
                sortDirection: draftSortDirection,
                section: null,
                manualBrowseMode: Boolean(
                  query.trim()
                  || !isDefaultFilters(normalized)
                  || draftSort !== 'trending'
                  || discoverContentType !== 'all'
                ),
              });
              setFiltersOpen(false);
            }}>
              Apply
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
