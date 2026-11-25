'use client';

import { Fragment } from 'react';
import { CheckCircle, Loader2, MoreHorizontal, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/media/search-input';
import { multiSelectFilters, searchFilter, type ActiveFilter } from '@/components/ui/active-filter-bar';
import {
  ResponsiveMenu,
  ResponsiveMenuActionItem,
  ResponsiveMenuCheckboxItem,
  ResponsiveMenuLabel,
  ResponsiveMenuSeparator,
  ResponsiveMenuSortDirection,
} from '@/components/ui/responsive-menu';
import type { ProwlarrAppProfile, ProwlarrIndexerSummary } from '@/lib/prowlarr-client';
import {
  defaultIndexerSortDirection,
  type ProwlarrIndexerState,
  type ProwlarrIndexerView,
} from '@/lib/prowlarr-indexer-view';
import type { Tag } from '@/types/arr';
import { FilterButton } from './filter-button';
import { INDEXER_SORT_OPTIONS, choicesOf, privacyLabel, protocolLabel } from './indexer-list';

const STATE_OPTIONS: { value: ProwlarrIndexerState; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
];

const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((other) => other !== value) : [...list, value]);

/**
 * The chips for every filter the menu sets (not the search box), each clearing
 * its own. Shared by the trigger's dot and the active filter bar.
 */
export function indexerMenuFilters(
  view: ProwlarrIndexerView,
  setView: (patch: Partial<ProwlarrIndexerView>) => void,
  tags: Tag[],
  profiles: ProwlarrAppProfile[],
): ActiveFilter[] {
  const asStrings = (values: number[]) => values.map(String);
  return [
    ...(view.state !== 'all'
      ? [{ id: 'state', label: view.state === 'enabled' ? 'Enabled' : 'Disabled', onRemove: () => setView({ state: 'all' }) }]
      : []),
    ...(view.failing ? [{ id: 'failing', label: 'Failing or blocked', onRemove: () => setView({ failing: false }) }] : []),
    ...multiSelectFilters(view.protocols, view.protocols.map((value) => ({ value, label: protocolLabel(value) })), (protocols) => setView({ protocols }))
      .map((filter) => ({ ...filter, id: `protocol:${filter.id}` })),
    ...multiSelectFilters(view.privacy, view.privacy.map((value) => ({ value, label: privacyLabel(value) })), (privacy) => setView({ privacy }))
      .map((filter) => ({ ...filter, id: `privacy:${filter.id}` })),
    ...multiSelectFilters(
      asStrings(view.tags),
      tags.map((tag) => ({ value: String(tag.id), label: `Tag: ${tag.label}` })),
      (next) => setView({ tags: next.map(Number) }),
    ).map((filter) => ({ ...filter, id: `tag:${filter.id}` })),
    ...multiSelectFilters(
      asStrings(view.appProfiles),
      profiles.map((profile) => ({ value: String(profile.id), label: `Profile: ${profile.name}` })),
      (next) => setView({ appProfiles: next.map(Number) }),
    ).map((filter) => ({ ...filter, id: `profile:${filter.id}` })),
  ];
}

/** Every chip under the toolbar: the search, then the menu's filters. */
export function indexerActiveFilters(
  view: ProwlarrIndexerView,
  setView: (patch: Partial<ProwlarrIndexerView>) => void,
  tags: Tag[],
  profiles: ProwlarrAppProfile[],
): ActiveFilter[] {
  return [...searchFilter(view.search, () => setView({ search: '' })), ...indexerMenuFilters(view, setView, tags, profiles)];
}

/**
 * The Indexers tab's one row: search, the filter and sort menu, and for users
 * who can manage, Sync All and Test All (in a ⋯ menu below md, so the row
 * never wraps on a phone).
 */
export function IndexerToolbar({
  view,
  setView,
  indexers,
  tags,
  profiles,
  canManage,
  syncing,
  testingAll,
  onSyncAll,
  onTestAll,
}: {
  view: ProwlarrIndexerView;
  setView: (patch: Partial<ProwlarrIndexerView>) => void;
  indexers: ProwlarrIndexerSummary[];
  tags: Tag[];
  profiles: ProwlarrAppProfile[];
  canManage: boolean;
  syncing: boolean;
  testingAll: boolean;
  onSyncAll: () => void;
  onTestAll: () => void;
}) {
  const menuFilters = indexerMenuFilters(view, setView, tags, profiles);
  const protocols = choicesOf(indexers, 'protocol', view.protocols);
  const privacy = choicesOf(indexers, 'privacy', view.privacy);
  const groups = [
    { key: 'protocol', title: 'Protocol', values: protocols, picked: view.protocols, label: protocolLabel, set: (protocols: string[]) => setView({ protocols }) },
    { key: 'privacy', title: 'Privacy', values: privacy, picked: view.privacy, label: privacyLabel, set: (privacy: string[]) => setView({ privacy }) },
  ];

  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <SearchInput
          clearable
          placeholder="Search indexers…"
          aria-label="Search indexers"
          value={view.search}
          onChange={(search) => setView({ search })}
          historyKey="prowlarr-indexers"
          className="pl-9"
        />
      </div>

      {/* 44px buttons with no gap between them on phones, as on Movies and Series. */}
      <div className="flex shrink-0 items-center md:gap-2">
      <ResponsiveMenu
        title="Filter and sort"
        align="end"
        contentClassName="w-56 max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto"
        trigger={<FilterButton label="Filter and sort" active={menuFilters.length > 0} />}
      >
        <ResponsiveMenuLabel>Status</ResponsiveMenuLabel>
        {STATE_OPTIONS.map((option) => (
          <ResponsiveMenuCheckboxItem
            key={option.value}
            checked={view.state === option.value}
            onCheckedChange={() => setView({ state: option.value })}
          >
            {option.label}
          </ResponsiveMenuCheckboxItem>
        ))}
        <ResponsiveMenuSeparator />
        <ResponsiveMenuLabel>Health</ResponsiveMenuLabel>
        <ResponsiveMenuCheckboxItem checked={view.failing} onCheckedChange={() => setView({ failing: !view.failing })}>
          Failing or blocked
        </ResponsiveMenuCheckboxItem>
        {groups.map((group) => group.values.length > 1 || group.picked.length > 0 ? (
          <Fragment key={group.key}>
            <ResponsiveMenuSeparator />
            <ResponsiveMenuLabel>{group.title}</ResponsiveMenuLabel>
            {group.values.map((value) => (
              <ResponsiveMenuCheckboxItem
                key={value}
                checked={group.picked.includes(value)}
                onCheckedChange={() => group.set(toggle(group.picked, value))}
              >
                {group.label(value)}
              </ResponsiveMenuCheckboxItem>
            ))}
          </Fragment>
        ) : null)}
        {tags.length > 0 && (
          <>
            <ResponsiveMenuSeparator />
            <ResponsiveMenuLabel>Tag</ResponsiveMenuLabel>
            {tags.map((tag) => (
              <ResponsiveMenuCheckboxItem
                key={tag.id}
                checked={view.tags.includes(tag.id)}
                onCheckedChange={() => setView({ tags: toggle(view.tags, tag.id) })}
              >
                <span className="min-w-0 truncate">{tag.label}</span>
              </ResponsiveMenuCheckboxItem>
            ))}
          </>
        )}
        {(profiles.length > 1 || view.appProfiles.length > 0) && (
          <>
            <ResponsiveMenuSeparator />
            <ResponsiveMenuLabel>App profile</ResponsiveMenuLabel>
            {profiles.map((profile) => (
              <ResponsiveMenuCheckboxItem
                key={profile.id}
                checked={view.appProfiles.includes(profile.id)}
                onCheckedChange={() => setView({ appProfiles: toggle(view.appProfiles, profile.id) })}
              >
                <span className="min-w-0 truncate">{profile.name}</span>
              </ResponsiveMenuCheckboxItem>
            ))}
          </>
        )}
        <ResponsiveMenuSeparator />
        <ResponsiveMenuLabel>Sort by</ResponsiveMenuLabel>
        <ResponsiveMenuSortDirection value={view.sortDirection} onChange={(sortDirection) => setView({ sortDirection })} />
        {INDEXER_SORT_OPTIONS.map((option) => (
          <ResponsiveMenuCheckboxItem
            key={option.key}
            checked={view.sort === option.key}
            onCheckedChange={() => {
              if (view.sort !== option.key) setView({ sort: option.key, sortDirection: defaultIndexerSortDirection(option.key) });
            }}
          >
            {option.label}
          </ResponsiveMenuCheckboxItem>
        ))}
      </ResponsiveMenu>

      {canManage && (
        <>
          <div className="hidden md:flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onSyncAll} disabled={syncing}>
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sync All
            </Button>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onTestAll} disabled={testingAll}>
              {testingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              Test All
            </Button>
          </div>
          <div className="flex md:hidden">
            <ResponsiveMenu
              title="Indexer actions"
              actions
              align="end"
              trigger={(
                <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Indexer actions">
                  {/* The sheet closes on a pick, so the spinner shows here. */}
                  {syncing || testingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                </Button>
              )}
            >
              <ResponsiveMenuActionItem onSelect={onSyncAll} disabled={syncing}>
                <RefreshCw className="h-4 w-4" />
                Sync All
              </ResponsiveMenuActionItem>
              <ResponsiveMenuActionItem onSelect={onTestAll} disabled={testingAll}>
                <CheckCircle className="h-4 w-4" />
                Test All
              </ResponsiveMenuActionItem>
            </ResponsiveMenu>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
