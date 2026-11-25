'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/query-fetch';
import {
  CALENDAR_MONITORED_DEFAULT_KEY,
  useCalendarMonitoredDefault,
  type CalendarMonitoredDefault,
} from '@/lib/hooks/use-calendar-monitored-default';

/**
 * Your own default for the Calendar page's "Monitored only" switch, saved to
 * your account. The page's switch changes only the visit it is flipped in.
 */
export function CalendarMonitoredDefaultRow() {
  const queryClient = useQueryClient();
  const { monitoredOnly, pending } = useCalendarMonitoredDefault();

  const save = useMutation({
    // Same scope as the other /api/me/settings writes, so they apply in order.
    scope: { id: 'me-settings' },
    mutationFn: async (calendarMonitoredOnly: boolean) => {
      const res = await fetch('/api/me/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarMonitoredOnly }),
      });
      if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
    },
    onMutate: async (calendarMonitoredOnly) => {
      // A refetch landing after this would put the old value back.
      await queryClient.cancelQueries({ queryKey: CALENDAR_MONITORED_DEFAULT_KEY });
      const previous = queryClient.getQueryData<CalendarMonitoredDefault>(CALENDAR_MONITORED_DEFAULT_KEY);
      queryClient.setQueryData<CalendarMonitoredDefault>(CALENDAR_MONITORED_DEFAULT_KEY, { ...previous, calendarMonitoredOnly });
      return { previous };
    },
    onError: (_err, _value, context) => {
      toast.error('Failed to save the calendar default');
      queryClient.setQueryData(CALENDAR_MONITORED_DEFAULT_KEY, context?.previous);
    },
  });

  return (
    <div className="grouped-row">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="flex h-8 w-8 items-center justify-center rounded-md shrink-0 bg-emerald-500/10 text-emerald-400">
          <Eye className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex flex-col items-start">
          <span className="text-[15px] font-medium truncate">Monitored only</span>
          <span className="text-[13px] text-muted-foreground">Synced across devices</span>
        </div>
      </div>
      <Switch
        aria-label="Monitored only by default"
        checked={monitoredOnly}
        disabled={pending}
        onCheckedChange={(value) => save.mutate(value)}
      />
    </div>
  );
}
