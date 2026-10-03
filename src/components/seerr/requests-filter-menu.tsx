'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter } from 'lucide-react';
import { jsonFetcher } from '@/lib/query-fetch';
import { Button } from '@/components/ui/button';
import { FilterDot, filterButtonLabel, type ActiveFilter } from '@/components/ui/active-filter-bar';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  type RequestsFilterPreference,
  type RequestsTypeFilterPreference,
} from '@/lib/store';
import type { SeerrPaginated, SeerrUserSummary } from '@/types/seerr';

const STATUS_FILTERS: { value: RequestsFilterPreference; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'processing', label: 'Processing' },
  { value: 'available', label: 'Available' },
  { value: 'unavailable', label: 'Unavailable' },
  { value: 'failed', label: 'Failed' },
  { value: 'completed', label: 'Completed' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'all', label: 'All' },
];

const TYPE_OPTIONS: { value: 'movie' | 'tv'; label: string }[] = [
  { value: 'movie', label: 'Movies' },
  { value: 'tv', label: 'Series' },
];

function userLabel(user: SeerrUserSummary): string {
  return (
    user.displayName ??
    user.username ??
    user.plexUsername ??
    user.jellyfinUsername ??
    user.email ??
    `User ${user.id}`
  );
}

export interface RequestsFilters {
  statusFilter: RequestsFilterPreference;
  onStatusFilterChange: (filter: RequestsFilterPreference) => void;
  typeFilter: RequestsTypeFilterPreference;
  onTypeFilterChange: (filter: RequestsTypeFilterPreference) => void;
  userFilter: number | null;
  onUserFilterChange: (userId: number | null) => void;
  showUserSection?: boolean;
}

function useSeerrUsers(enabled: boolean) {
  const usersQuery = useQuery({
    queryKey: ['seerr', 'users'],
    queryFn: jsonFetcher<SeerrPaginated<SeerrUserSummary>>('/api/seerr/users?take=100'),
    enabled,
  });
  return useMemo(() => usersQuery.data?.results ?? [], [usersQuery.data]);
}

/**
 * The request filters in force, as chips. Pending is only the default status:
 * it still hides every other request, so it shows like any other choice.
 */
export function useRequestsActiveFilters({
  statusFilter,
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
  userFilter,
  onUserFilterChange,
  showUserSection = false,
}: RequestsFilters): ActiveFilter[] {
  const users = useSeerrUsers(showUserSection);
  const filters: ActiveFilter[] = [];
  if (statusFilter !== 'all') {
    filters.push({
      id: 'status',
      label: STATUS_FILTERS.find((f) => f.value === statusFilter)?.label ?? statusFilter,
      onRemove: () => onStatusFilterChange('all'),
    });
  }
  for (const type of typeFilter) {
    filters.push({
      id: `type:${type}`,
      label: TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type,
      onRemove: () => onTypeFilterChange(typeFilter.filter((t) => t !== type)),
    });
  }
  if (showUserSection && userFilter != null) {
    const user = users.find((u) => u.id === userFilter);
    filters.push({
      id: 'user',
      label: `Requested by ${user ? userLabel(user) : `user ${userFilter}`}`,
      onRemove: () => onUserFilterChange(null),
    });
  }
  return filters;
}

export interface RequestsFilterMenuProps {
  /** The chips from {@link useRequestsActiveFilters}, for the dot and the name. */
  activeFilters: ActiveFilter[];
  statusFilter: RequestsFilterPreference;
  onStatusFilterChange: (filter: RequestsFilterPreference) => void;
  typeFilter: RequestsTypeFilterPreference;
  onTypeFilterChange: (filter: RequestsTypeFilterPreference) => void;
  userFilter: number | null;
  onUserFilterChange: (userId: number | null) => void;
  showUserSection?: boolean;
}

export function RequestsFilterMenu({
  activeFilters,
  statusFilter,
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
  userFilter,
  onUserFilterChange,
  showUserSection = false,
}: RequestsFilterMenuProps) {
  const users = useSeerrUsers(showUserSection);

  const toggleType = (value: 'movie' | 'tv') => {
    onTypeFilterChange(
      typeFilter.includes(value)
        ? typeFilter.filter((t) => t !== value)
        : [...typeFilter, value],
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8"
          aria-label={filterButtonLabel(
            `Filter: ${activeFilters.map((f) => f.label).join(', ') || 'All'}`,
            activeFilters.length > 0,
          )}
        >
          <Filter className="h-4 w-4" />
          <FilterDot active={activeFilters.length > 0} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel>Status</DropdownMenuLabel>
        {STATUS_FILTERS.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.value}
            checked={statusFilter === opt.value}
            onCheckedChange={() => onStatusFilterChange(opt.value)}
            onSelect={(e) => e.preventDefault()}
          >
            {opt.label}
          </DropdownMenuCheckboxItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Type</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={typeFilter.length === 0}
          onCheckedChange={() => onTypeFilterChange([])}
          onSelect={(e) => e.preventDefault()}
        >
          All
        </DropdownMenuCheckboxItem>
        {TYPE_OPTIONS.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.value}
            checked={typeFilter.includes(opt.value)}
            onCheckedChange={() => toggleType(opt.value)}
            onSelect={(e) => e.preventDefault()}
          >
            {opt.label}
          </DropdownMenuCheckboxItem>
        ))}

        {showUserSection ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>User</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={userFilter === null}
              onCheckedChange={() => onUserFilterChange(null)}
              onSelect={(e) => e.preventDefault()}
            >
              All users
            </DropdownMenuCheckboxItem>
            {users.map((user) => (
              <DropdownMenuCheckboxItem
                key={user.id}
                checked={userFilter === user.id}
                onCheckedChange={() => onUserFilterChange(user.id)}
                onSelect={(e) => e.preventDefault()}
              >
                <span className="truncate">{userLabel(user)}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
