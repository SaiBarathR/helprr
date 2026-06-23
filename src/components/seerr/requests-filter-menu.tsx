'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter } from 'lucide-react';
import { jsonFetcher } from '@/lib/query-fetch';
import { Button } from '@/components/ui/button';
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

export interface RequestsFilterMenuProps {
  statusFilter: RequestsFilterPreference;
  onStatusFilterChange: (filter: RequestsFilterPreference) => void;
  typeFilter: RequestsTypeFilterPreference;
  onTypeFilterChange: (filter: RequestsTypeFilterPreference) => void;
  userFilter: number | null;
  onUserFilterChange: (userId: number | null) => void;
  showUserSection?: boolean;
}

export function RequestsFilterMenu({
  statusFilter,
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
  userFilter,
  onUserFilterChange,
  showUserSection = false,
}: RequestsFilterMenuProps) {
  const usersQuery = useQuery({
    queryKey: ['seerr', 'users'],
    queryFn: jsonFetcher<SeerrPaginated<SeerrUserSummary>>('/api/seerr/users?take=100'),
    enabled: showUserSection,
  });

  const users = useMemo(() => usersQuery.data?.results ?? [], [usersQuery.data]);

  const activeUserLabel = useMemo(() => {
    if (userFilter == null) return null;
    const user = users.find((u) => u.id === userFilter);
    return user ? userLabel(user) : `User ${userFilter}`;
  }, [userFilter, users]);

  const activeFilterLabel = useMemo(() => {
    const parts: string[] = [];
    if (statusFilter !== 'pending') {
      parts.push(STATUS_FILTERS.find((f) => f.value === statusFilter)?.label ?? statusFilter);
    }
    if (typeFilter.length === 1) {
      parts.push(TYPE_OPTIONS.find((o) => o.value === typeFilter[0])?.label ?? typeFilter[0]);
    } else if (typeFilter.length > 1) {
      parts.push(`${typeFilter.length} types`);
    }
    if (activeUserLabel) parts.push(activeUserLabel);
    return parts.length === 0 ? 'All' : parts.join(', ');
  }, [statusFilter, typeFilter, activeUserLabel]);

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
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Filter: ${activeFilterLabel}`}>
          <Filter className="h-4 w-4" />
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
