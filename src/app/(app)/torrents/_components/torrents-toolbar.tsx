'use client';

import type { Ref } from 'react';
import { SearchInput } from '@/components/media/search-input';
import { FilterDot, filterButtonLabel, type ActiveFilter } from '@/components/ui/active-filter-bar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ArrowDown, ArrowUp, ArrowUpDown, Filter, Gauge, Link2, Plus, RefreshCw, Search, Settings } from 'lucide-react';
import type { QBittorrentTransferInfo } from '@/types';
import type { TorrentsFilterPreference as FilterType, TorrentsSortKeyPreference as SortKey } from '@/lib/store';
import { SORT_OPTIONS, filterOptions, formatSpeed } from './torrent-list';

/** The torrents toolbar: filter and sort menus, refresh, alt speed, the page links, the transfer totals and search. */
export function TorrentsToolbar({
  ref,
  menuFilters,
  filter,
  setFilter,
  sortKey,
  sortDir,
  handleHeaderSort,
  refresh,
  refreshing,
  canBandwidthTorrents,
  speedLimitsMode,
  toggleAltSpeedMode,
  router,
  canViewLinked,
  canAddTorrents,
  transferInfo,
  search,
  setSearch,
}: {
  ref?: Ref<HTMLDivElement>;
  menuFilters: ActiveFilter[];
  filter: FilterType[];
  setFilter: (filter: FilterType[]) => void;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  handleHeaderSort: (key: SortKey) => void;
  refresh: () => void;
  refreshing: boolean;
  canBandwidthTorrents: boolean;
  speedLimitsMode: number;
  toggleAltSpeedMode: () => void;
  router: { push: (href: string) => void };
  canViewLinked: boolean;
  canAddTorrents: boolean;
  transferInfo: QBittorrentTransferInfo | null;
  search: string;
  setSearch: (search: string) => void;
}) {
  return (
    <div ref={ref} className="page-toolbar page-toolbar-flush pb-2 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 space-y-2">
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="relative p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
              aria-label={filterButtonLabel(
                `Filter: ${menuFilters.map((f) => f.label).join(', ') || 'All'}`,
                menuFilters.length > 0,
              )}
            >
              <Filter className="h-5 w-5" />
              <FilterDot active={menuFilters.length > 0} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Filter</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={filter.length === 0}
              onCheckedChange={() => setFilter([])}
              onSelect={(e) => e.preventDefault()}
            >
              All
            </DropdownMenuCheckboxItem>
            {filterOptions.map((opt) => (
              <DropdownMenuCheckboxItem
                key={opt.value}
                checked={filter.includes(opt.value)}
                onCheckedChange={() => setFilter(
                  filter.includes(opt.value)
                    ? filter.filter((f) => f !== opt.value)
                    : [...filter, opt.value]
                )}
                onSelect={(e) => e.preventDefault()}
              >
                {opt.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
              aria-label="Sort"
            >
              <ArrowUpDown className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52 max-h-80 overflow-y-auto">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {SORT_OPTIONS.map((opt) => (
              <DropdownMenuCheckboxItem
                key={opt.key}
                checked={sortKey === opt.key}
                onCheckedChange={() => handleHeaderSort(opt.key)}
                onSelect={(e) => e.preventDefault()}
              >
                {opt.label}
                {sortKey === opt.key && (
                  <span className="ml-auto text-[10px] text-muted-foreground">{sortDir === 'asc' ? '↑' : '↓'}</span>
                )}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors disabled:opacity-60 disabled:cursor-default"
              onClick={refresh}
              disabled={refreshing}
              aria-label="Refresh"
            >
              <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>

        {canBandwidthTorrents && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className={`p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${
                  speedLimitsMode === 1
                    ? 'bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30'
                    : 'hover:bg-accent active:bg-accent/80'
                }`}
                onClick={toggleAltSpeedMode}
                aria-label="Alternative Speed Limits"
              >
                <Gauge className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{speedLimitsMode === 1 ? 'Alt Speed: ON' : 'Alt Speed: OFF'}</TooltipContent>
          </Tooltip>
        )}

        <div className="flex-1" />

        {canBandwidthTorrents && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
                onClick={() => router.push('/torrents/settings')}
                aria-label="Settings"
              >
                <Settings className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        )}

        {canViewLinked && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
                onClick={() => router.push('/torrents/linked')}
                aria-label="Linked downloads"
              >
                <Link2 className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Linked downloads (sent to Sonarr/Radarr)</TooltipContent>
          </Tooltip>
        )}

        {canAddTorrents && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors"
                onClick={() => router.push('/torrents/add')}
                aria-label="Add Torrent"
              >
                <Plus className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Add Torrent</TooltipContent>
          </Tooltip>
        )}
      </div>

      {transferInfo && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <ArrowDown className="h-3 w-3 text-green-500" />
            {formatSpeed(transferInfo.dl_info_speed)}
          </span>
          <span className="flex items-center gap-1">
            <ArrowUp className="h-3 w-3 text-blue-500" />
            {formatSpeed(transferInfo.up_info_speed)}
          </span>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <SearchInput
          clearable
          placeholder="Search torrents..."
          value={search}
          onChange={setSearch}
          historyKey="torrents"
          className="pl-9"
        />
      </div>
    </div>
  );
}
