'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { ResponsiveCombobox } from '@/components/ui/responsive-combobox';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { getSupportedTimeZones } from '@/lib/timezone';

interface TimeZoneSettings {
  /** null: "Same as the server". */
  timeZone: string | null;
  serverTimeZone: string;
}

const QUERY_KEY = ['me-time-zone'] as const;

function zoneLabel(zone: string): string {
  return zone.replaceAll('_', ' ');
}

/**
 * Your own time zone, saved to your account: your calendar feed, quiet hours
 * and other times the server works out for you use it. Screens in the app keep
 * showing times in the device's zone.
 */
export function PersonalTimeZoneRow() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: jsonFetcher<TimeZoneSettings>('/api/me/settings'),
  });

  // This browser's list, plus a saved zone it does not name (another browser's spelling).
  const savedZone = data?.timeZone ?? null;
  const zones = useMemo(() => {
    const list = getSupportedTimeZones();
    return savedZone && !list.includes(savedZone) ? [savedZone, ...list] : list;
  }, [savedZone]);

  const save = useMutation({
    // Same scope as the other /api/me/settings writes, so they apply in order.
    scope: { id: 'me-settings' },
    mutationFn: async (timeZone: string | null) => {
      const res = await fetch('/api/me/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeZone }),
      });
      if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
    },
    onMutate: async (timeZone) => {
      // A refetch landing after this would put the old value back.
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<TimeZoneSettings>(QUERY_KEY);
      if (previous) queryClient.setQueryData<TimeZoneSettings>(QUERY_KEY, { ...previous, timeZone });
      return { previous };
    },
    onError: (_err, _zone, context) => {
      toast.error('Failed to save your time zone');
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
    },
  });

  function pick(timeZone: string | null) {
    setOpen(false);
    if (data && timeZone !== data.timeZone) save.mutate(timeZone);
  }

  const current = savedZone;

  return (
    <div className="grouped-row">
      <span className="text-sm shrink-0">Your time zone</span>
      <ResponsiveCombobox
        open={open}
        onOpenChange={setOpen}
        title="Your time zone"
        searchPlaceholder="Search time zones"
        align="end"
        trigger={
          <button
            type="button"
            aria-label="Your time zone"
            disabled={!data}
            className="flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors dark:bg-input/30 dark:hover:bg-input/50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="truncate">{data ? (current ? zoneLabel(current) : 'Same as the server') : ''}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </button>
        }
      >
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup>
          <CommandItem value={`Same as the server ${data?.serverTimeZone ?? ''}`} onSelect={() => pick(null)}>
            <span className="flex-1">Same as the server</span>
            <span className="text-xs text-muted-foreground">{data ? zoneLabel(data.serverTimeZone) : ''}</span>
            {current === null && <Check className="h-3.5 w-3.5 ml-1" />}
          </CommandItem>
          {zones.map((zone) => (
            <CommandItem key={zone} value={zoneLabel(zone)} onSelect={() => pick(zone)}>
              <span className="flex-1 truncate">{zoneLabel(zone)}</span>
              {current === zone && <Check className="h-3.5 w-3.5 ml-1" />}
            </CommandItem>
          ))}
        </CommandGroup>
      </ResponsiveCombobox>
    </div>
  );
}
