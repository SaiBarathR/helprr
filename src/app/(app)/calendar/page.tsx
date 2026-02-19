'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  addWeeks,
  format,
  isSameDay,
  eachDayOfInterval,
  isToday,
  isSameMonth,
} from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Tv,
  Film,
  Bookmark,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCalendar } from '@/hooks/use-calendar';
import { useUIStore } from '@/lib/store';
import type { CalendarEvent } from '@/types';

// ─── Compact Filter Icons ──────────────────────────────────────────────────

function CompactFilters({
  typeFilter,
  setTypeFilter,
  monitoredOnly,
  setMonitoredOnly,
}: {
  typeFilter: 'all' | 'episode' | 'movie';
  setTypeFilter: (v: 'all' | 'episode' | 'movie') => void;
  monitoredOnly: boolean;
  setMonitoredOnly: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {/* Type filter icons */}
      <button
        onClick={() => setTypeFilter('all')}
        className={`p-1.5 rounded-md transition-colors ${typeFilter === 'all'
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        title="All"
      >
        <span className="text-[10px] font-bold leading-none">ALL</span>
      </button>
      <button
        onClick={() => setTypeFilter('episode')}
        className={`p-1.5 rounded-md transition-colors ${typeFilter === 'episode'
          ? 'bg-blue-500/15 text-blue-400'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        title="Episodes"
      >
        <Tv className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => setTypeFilter('movie')}
        className={`p-1.5 rounded-md transition-colors ${typeFilter === 'movie'
          ? 'bg-orange-500/15 text-orange-400'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        title="Movies"
      >
        <Film className="h-3.5 w-3.5" />
      </button>

      <div className="w-px h-4 bg-border/50 mx-0.5" />

      {/* Monitored toggle */}
      <button
        onClick={() => setMonitoredOnly(!monitoredOnly)}
        className={`p-1.5 rounded-md transition-colors ${monitoredOnly
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        title={monitoredOnly ? 'Showing monitored only' : 'Showing all'}
      >
        {monitoredOnly ? (
          <Eye className="h-3.5 w-3.5" />
        ) : (
          <EyeOff className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

// ─── Agenda View (LunaSea-style) ───────────────────────────────────────────

function AgendaView({ events }: { events: CalendarEvent[] }) {
  const grouped = useMemo(() => {
    const groups: Record<string, CalendarEvent[]> = {};
    for (const event of events) {
      const key = format(new Date(event.date), 'yyyy-MM-dd');
      if (!groups[key]) groups[key] = [];
      groups[key].push(event);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  if (grouped.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-sm">No events in this period.</p>
      </div>
    );
  }

  return (
    <div>
      {grouped.map(([dateKey, dayEvents]) => {
        const date = new Date(dateKey + 'T00:00:00');
        const today = isToday(date);

        return dayEvents.map((event, idx) => {
          const isFirstOfDay = idx === 0;
          const href =
            event.type === 'episode'
              ? `/series/${event.seriesId}`
              : `/movies/${event.movieId}`;
          const eventDate = new Date(event.date);

          return (
            <Link key={event.id} href={href} className="block active:bg-muted/30">
              <div
                className={`flex items-start gap-4 py-3 px-1 border-b border-border/30 ${!event.monitored ? 'opacity-50' : ''
                  } ${event.hasFile ? 'opacity-60' : ''}`}
              >
                {/* Date column - only show for first event of the day */}
                <div className="w-10 shrink-0 text-center">
                  {isFirstOfDay && (
                    <>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                        {format(date, 'EEE')}
                      </p>
                      <p
                        className={`text-2xl font-bold leading-tight ${today ? 'text-primary' : 'text-foreground'
                          }`}
                      >
                        {format(date, 'd')}
                      </p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        {format(date, 'MMM')}
                      </p>
                    </>
                  )}
                </div>

                {/* Event info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {event.type === 'episode' ? (
                        <Tv className="h-3 w-3 text-blue-400 shrink-0" />
                      ) : (
                        <Film className="h-3 w-3 text-orange-400 shrink-0" />
                      )}
                      <p
                        className={`text-sm font-semibold truncate ${event.hasFile
                          ? 'line-through text-muted-foreground'
                          : 'text-foreground'
                          }`}
                      >
                        {event.title}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2 tabular-nums">
                      {format(eventDate, 'h:mm a')}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate pl-[18px]">
                    {event.subtitle}
                  </p>
                </div>

                {/* Monitored indicator */}
                {event.monitored && (
                  <Bookmark className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 mt-0.5" />
                )}
              </div>
            </Link>
          );
        });
      })}
    </div>
  );
}

// ─── Month View ─────────────────────────────────────────────────────────────

function MonthView({
  currentDate,
  events,
}: {
  currentDate: Date;
  events: CalendarEvent[];
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="w-full">
      <div className="grid grid-cols-7 mb-1">
        {weekdays.map((day) => (
          <div
            key={day}
            className="text-center text-[10px] font-medium text-muted-foreground py-1.5"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 border-t border-l border-border/40">
        {days.map((day) => {
          const dayEvents = events.filter((e) =>
            isSameDay(new Date(e.date), day)
          );
          const inMonth = isSameMonth(day, currentDate);
          const today = isToday(day);

          return (
            <div
              key={day.toISOString()}
              className={`min-h-[72px] md:min-h-[100px] border-r border-b border-border/40 p-1 transition-colors ${!inMonth ? 'bg-muted/20' : ''
                } ${today ? 'bg-primary/5' : ''}`}
            >
              <div
                className={`text-xs font-medium mb-0.5 ${today
                  ? 'text-primary font-bold'
                  : inMonth
                    ? 'text-foreground'
                    : 'text-muted-foreground/40'
                  }`}
              >
                <span
                  className={`inline-flex items-center justify-center ${today
                    ? 'bg-primary text-primary-foreground rounded-full w-5 h-5 text-[10px]'
                    : ''
                    }`}
                >
                  {format(day, 'd')}
                </span>
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((event) => {
                  const href =
                    event.type === 'episode'
                      ? `/series/${event.seriesId}`
                      : `/movies/${event.movieId}`;
                  return (
                    <Link key={event.id} href={href} className="block">
                      <div
                        className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] leading-tight font-medium truncate transition-opacity hover:opacity-80 ${event.type === 'episode'
                          ? 'bg-blue-500/15 text-blue-400'
                          : 'bg-orange-500/15 text-orange-400'
                          } ${!event.monitored ? 'opacity-50' : ''} ${event.hasFile ? 'line-through decoration-1' : ''
                          }`}
                      >
                        {event.type === 'episode' ? (
                          <Tv className="h-2 w-2 shrink-0" />
                        ) : (
                          <Film className="h-2 w-2 shrink-0" />
                        )}
                        <span className="truncate">{event.title}</span>
                      </div>
                    </Link>
                  );
                })}
                {dayEvents.length > 3 && (
                  <p className="text-[9px] text-muted-foreground pl-1">
                    +{dayEvents.length - 3} more
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Week View ──────────────────────────────────────────────────────────────

function WeekView({
  currentDate,
  events,
}: {
  currentDate: Date;
  events: CalendarEvent[];
}) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  return (
    <div className="space-y-2">
      {days.map((day) => {
        const dayEvents = events.filter((e) =>
          isSameDay(new Date(e.date), day)
        );
        const today = isToday(day);

        return (
          <div
            key={day.toISOString()}
            className={`rounded-lg border transition-colors ${today ? 'border-primary/40 bg-primary/5' : 'border-border/40'
              }`}
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
              <span
                className={`text-xs font-medium uppercase ${today ? 'text-primary' : 'text-muted-foreground'
                  }`}
              >
                {format(day, 'EEE')}
              </span>
              <span
                className={`text-sm font-semibold ${today ? 'text-primary' : 'text-foreground'
                  }`}
              >
                {format(day, 'd MMM')}
              </span>
              {today && (
                <span className="text-[10px] text-primary/70 font-normal">
                  Today
                </span>
              )}
            </div>
            {dayEvents.length === 0 ? (
              <div className="px-3 py-2">
                <p className="text-xs text-muted-foreground/40 italic">
                  No events
                </p>
              </div>
            ) : (
              <div>
                {dayEvents.map((event) => {
                  const href =
                    event.type === 'episode'
                      ? `/series/${event.seriesId}`
                      : `/movies/${event.movieId}`;
                  return (
                    <Link key={event.id} href={href} className="block">
                      <div
                        className={`flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/30 active:bg-muted/50 ${!event.monitored ? 'opacity-50' : ''
                          }`}
                      >
                        {event.type === 'episode' ? (
                          <Tv className="h-3 w-3 text-blue-400 shrink-0" />
                        ) : (
                          <Film className="h-3 w-3 text-orange-400 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm font-medium truncate ${event.hasFile
                              ? 'line-through text-muted-foreground'
                              : ''
                              }`}
                          >
                            {event.title}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {event.subtitle}
                          </p>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                          {format(new Date(event.date), 'h:mm a')}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Loading Skeleton ───────────────────────────────────────────────────────

function CalendarSkeleton() {
  return (
    <div className="space-y-3 pt-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-start gap-4 py-3 px-1">
          <div className="w-10 shrink-0 flex flex-col items-center gap-0.5">
            <Skeleton className="h-2.5 w-6" />
            <Skeleton className="h-7 w-7 rounded" />
            <Skeleton className="h-2.5 w-6" />
          </div>
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-14" />
            </div>
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── View Tabs (compact pill style) ─────────────────────────────────────────

type ViewType = 'agenda' | 'month' | 'week';

function ViewTabs({
  value,
  onChange,
}: {
  value: ViewType;
  onChange: (v: ViewType) => void;
}) {
  const views: { key: ViewType; label: string }[] = [
    { key: 'agenda', label: 'Agenda' },
    { key: 'week', label: 'Week' },
    { key: 'month', label: 'Month' },
  ];

  return (
    <div className="flex items-center rounded-lg bg-muted/60 p-0.5">
      {views.map((v) => (
        <button
          key={v.key}
          onClick={() => onChange(v.key)}
          className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${value === v.key
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
            }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const {
    calendarView,
    setCalendarView,
    calendarTypeFilter: typeFilter,
    setCalendarTypeFilter: setTypeFilter,
    calendarMonitoredOnly: monitoredOnly,
    setCalendarMonitoredOnly: setMonitoredOnly,
  } = useUIStore();

  const [currentDate, setCurrentDate] = useState(new Date());

  // Calculate date range based on view
  const { start, end } = useMemo(() => {
    if (calendarView === 'month') {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      return {
        start: startOfWeek(monthStart, { weekStartsOn: 1 }),
        end: endOfWeek(monthEnd, { weekStartsOn: 1 }),
      };
    } else if (calendarView === 'week') {
      return {
        start: startOfWeek(currentDate, { weekStartsOn: 1 }),
        end: endOfWeek(currentDate, { weekStartsOn: 1 }),
      };
    } else {
      return {
        start: startOfMonth(currentDate),
        end: endOfMonth(currentDate),
      };
    }
  }, [calendarView, currentDate]);

  const { events, loading, error } = useCalendar({
    start,
    end,
    type: typeFilter !== 'all' ? typeFilter : undefined,
  });

  // Apply monitored filter client-side
  const filteredEvents = useMemo(() => {
    if (!monitoredOnly) return events;
    return events.filter((e) => e.monitored);
  }, [events, monitoredOnly]);

  // Navigation
  function goForward() {
    if (calendarView === 'week') {
      setCurrentDate((d) => addWeeks(d, 1));
    } else {
      setCurrentDate((d) => addMonths(d, 1));
    }
  }

  function goBack() {
    if (calendarView === 'week') {
      setCurrentDate((d) => addWeeks(d, -1));
    } else {
      setCurrentDate((d) => addMonths(d, -1));
    }
  }

  function goToday() {
    setCurrentDate(new Date());
  }

  // Header label
  const headerLabel = useMemo(() => {
    if (calendarView === 'week') {
      const ws = startOfWeek(currentDate, { weekStartsOn: 1 });
      const we = endOfWeek(currentDate, { weekStartsOn: 1 });
      return `${format(ws, 'MMM d')} – ${format(we, 'MMM d, yyyy')}`;
    }
    return format(currentDate, 'MMMM yyyy');
  }, [calendarView, currentDate]);

  return (
    <div className="space-y-3">
      {/* Top bar: title + view tabs */}
      <div className="flex items-center justify-between md:hidden">
        <ViewTabs
          value={calendarView}
          onChange={(v) => setCalendarView(v)}
        />
        <CompactFilters
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          monitoredOnly={monitoredOnly}
          setMonitoredOnly={setMonitoredOnly}
        />
      </div>

      {/* Navigation row: arrows, today, period label, filters */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={goBack}
            className="h-7 w-7 shrink-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={goForward}
            className="h-7 w-7 shrink-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <button
            onClick={goToday}
            className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors shrink-0 px-1"
          >
            Today
          </button>
          <span className="text-sm font-semibold truncate">{headerLabel}</span>
        </div>
        <div className="items-center justify-between hidden md:flex gap-2">
          <ViewTabs
            value={calendarView}
            onChange={(v) => setCalendarView(v)}
          />
          <CompactFilters
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
            monitoredOnly={monitoredOnly}
            setMonitoredOnly={setMonitoredOnly}
          />
        </div>

      </div>

      {/* Error state */}
      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-3 text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {loading && <CalendarSkeleton />}

      {/* Calendar views */}
      {!loading && (
        <>
          {calendarView === 'agenda' && (
            <AgendaView events={filteredEvents} />
          )}
          {calendarView === 'month' && (
            <MonthView currentDate={currentDate} events={filteredEvents} />
          )}
          {calendarView === 'week' && (
            <WeekView currentDate={currentDate} events={filteredEvents} />
          )}
        </>
      )}
    </div>
  );
}
