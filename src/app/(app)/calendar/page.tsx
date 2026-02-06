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
import { ChevronLeft, ChevronRight, Filter, Tv, Film } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useCalendar } from '@/hooks/use-calendar';
import { useUIStore } from '@/lib/store';
import type { CalendarEvent } from '@/types';

// ─── Filter Controls ────────────────────────────────────────────────────────

function FilterBar({
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
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Filter className="h-4 w-4" />
      </div>
      <div className="flex items-center rounded-lg bg-muted p-0.5 gap-0.5">
        {(['all', 'episode', 'movie'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              typeFilter === t
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'all' ? 'All' : t === 'episode' ? 'Episodes' : 'Movies'}
          </button>
        ))}
      </div>
      <button
        onClick={() => setMonitoredOnly(!monitoredOnly)}
        className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
          monitoredOnly
            ? 'border-primary/50 bg-primary/10 text-primary'
            : 'border-border text-muted-foreground hover:text-foreground'
        }`}
      >
        Monitored only
      </button>
    </div>
  );
}

// ─── Event Pill ─────────────────────────────────────────────────────────────

function EventPill({ event }: { event: CalendarEvent }) {
  const href =
    event.type === 'episode'
      ? `/series/${event.seriesId}`
      : `/movies/${event.movieId}`;

  return (
    <Link href={href} className="block">
      <div
        className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] leading-tight font-medium truncate transition-opacity hover:opacity-80 ${
          event.type === 'episode'
            ? 'bg-blue-500/15 text-blue-400'
            : 'bg-orange-500/15 text-orange-400'
        } ${!event.monitored ? 'opacity-50' : ''} ${event.hasFile ? 'line-through decoration-1' : ''}`}
      >
        {event.type === 'episode' ? (
          <Tv className="h-2.5 w-2.5 shrink-0" />
        ) : (
          <Film className="h-2.5 w-2.5 shrink-0" />
        )}
        <span className="truncate">{event.title}</span>
      </div>
    </Link>
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
      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {weekdays.map((day) => (
          <div
            key={day}
            className="text-center text-xs font-medium text-muted-foreground py-2"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 border-t border-l border-border/50">
        {days.map((day) => {
          const dayEvents = events.filter((e) => isSameDay(new Date(e.date), day));
          const inMonth = isSameMonth(day, currentDate);
          const today = isToday(day);

          return (
            <div
              key={day.toISOString()}
              className={`min-h-[80px] md:min-h-[100px] border-r border-b border-border/50 p-1 transition-colors ${
                !inMonth ? 'bg-muted/30' : ''
              } ${today ? 'bg-primary/5' : ''}`}
            >
              <div
                className={`text-xs font-medium mb-0.5 ${
                  today
                    ? 'text-primary font-bold'
                    : inMonth
                      ? 'text-foreground'
                      : 'text-muted-foreground/50'
                }`}
              >
                <span
                  className={`inline-flex items-center justify-center ${
                    today
                      ? 'bg-primary text-primary-foreground rounded-full w-5 h-5 text-[10px]'
                      : ''
                  }`}
                >
                  {format(day, 'd')}
                </span>
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((event) => (
                  <EventPill key={event.id} event={event} />
                ))}
                {dayEvents.length > 3 && (
                  <p className="text-[10px] text-muted-foreground pl-1">
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
    <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
      {days.map((day) => {
        const dayEvents = events.filter((e) => isSameDay(new Date(e.date), day));
        const today = isToday(day);

        return (
          <Card
            key={day.toISOString()}
            className={`${today ? 'border-primary/50 bg-primary/5' : ''}`}
          >
            <CardContent className="p-3">
              <div
                className={`text-sm font-medium mb-2 ${
                  today ? 'text-primary' : 'text-foreground'
                }`}
              >
                <span className="block text-xs text-muted-foreground">
                  {format(day, 'EEE')}
                </span>
                <span
                  className={`inline-flex items-center justify-center ${
                    today
                      ? 'bg-primary text-primary-foreground rounded-full w-6 h-6 text-xs'
                      : ''
                  }`}
                >
                  {format(day, 'd MMM')}
                </span>
              </div>
              {dayEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground/50 italic">
                  No events
                </p>
              ) : (
                <div className="space-y-1.5">
                  {dayEvents.map((event) => (
                    <Link
                      key={event.id}
                      href={
                        event.type === 'episode'
                          ? `/series/${event.seriesId}`
                          : `/movies/${event.movieId}`
                      }
                    >
                      <div
                        className={`rounded-lg p-2 transition-colors hover:opacity-80 ${
                          event.type === 'episode'
                            ? 'bg-blue-500/10 border border-blue-500/20'
                            : 'bg-orange-500/10 border border-orange-500/20'
                        } ${!event.monitored ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {event.type === 'episode' ? (
                            <Tv className="h-3 w-3 text-blue-400 shrink-0" />
                          ) : (
                            <Film className="h-3 w-3 text-orange-400 shrink-0" />
                          )}
                          <span
                            className={`text-xs font-medium truncate ${
                              event.hasFile ? 'line-through' : ''
                            }`}
                          >
                            {event.title}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate pl-[18px]">
                          {event.subtitle}
                        </p>
                        <p className="text-[10px] text-muted-foreground/70 pl-[18px]">
                          {format(new Date(event.date), 'h:mm a')}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Agenda View ────────────────────────────────────────────────────────────

function AgendaView({ events }: { events: CalendarEvent[] }) {
  // Group events by date
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
      <div className="text-center py-12 text-muted-foreground">
        No events in this period.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {grouped.map(([dateKey, dayEvents]) => {
        const date = new Date(dateKey + 'T00:00:00');
        const today = isToday(date);

        return (
          <div key={dateKey}>
            <div
              className={`sticky top-0 z-10 py-1.5 px-2 text-xs font-semibold rounded-md mb-1.5 ${
                today
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {format(date, 'EEEE, MMMM d')}
              {today && (
                <span className="ml-2 text-[10px] font-normal">(Today)</span>
              )}
            </div>
            <div className="space-y-1">
              {dayEvents.map((event) => (
                <Link
                  key={event.id}
                  href={
                    event.type === 'episode'
                      ? `/series/${event.seriesId}`
                      : `/movies/${event.movieId}`
                  }
                >
                  <div
                    className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors hover:bg-muted/50 ${
                      !event.monitored ? 'opacity-50' : ''
                    }`}
                  >
                    <Badge
                      variant="secondary"
                      className={
                        event.type === 'episode'
                          ? 'bg-blue-500/10 text-blue-400'
                          : 'bg-orange-500/10 text-orange-400'
                      }
                    >
                      {event.type === 'episode' ? (
                        <Tv className="h-3 w-3" />
                      ) : (
                        <Film className="h-3 w-3" />
                      )}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-medium truncate ${
                          event.hasFile ? 'line-through text-muted-foreground' : ''
                        }`}
                      >
                        {event.title}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {event.subtitle}
                      </p>
                    </div>
                    <div className="text-[10px] text-muted-foreground shrink-0">
                      {format(new Date(event.date), 'h:mm a')}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Loading Skeleton ───────────────────────────────────────────────────────

function CalendarSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-32" />
      </div>
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-7 gap-1">
        {[...Array(35)].map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { calendarView, setCalendarView } = useUIStore();
  const [currentDate, setCurrentDate] = useState(new Date());
  const { calendarTypeFilter: typeFilter, setCalendarTypeFilter: setTypeFilter, calendarMonitoredOnly: monitoredOnly, setCalendarMonitoredOnly: setMonitoredOnly } = useUIStore();

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
      // Agenda: show current month
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
    if (calendarView === 'month') {
      setCurrentDate((d) => addMonths(d, 1));
    } else if (calendarView === 'week') {
      setCurrentDate((d) => addWeeks(d, 1));
    } else {
      setCurrentDate((d) => addMonths(d, 1));
    }
  }

  function goBack() {
    if (calendarView === 'month') {
      setCurrentDate((d) => addMonths(d, -1));
    } else if (calendarView === 'week') {
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
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
      return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;
    }
    return format(currentDate, 'MMMM yyyy');
  }, [calendarView, currentDate]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <CalendarSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <Tabs
          value={calendarView}
          onValueChange={(v) =>
            setCalendarView(v as 'month' | 'week' | 'agenda')
          }
        >
          <TabsList>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="agenda">Agenda</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Navigation + Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={goBack} className="h-8 w-8">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={goForward} className="h-8 w-8">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={goToday} className="text-xs">
            Today
          </Button>
          <h2 className="text-base font-semibold ml-1">{headerLabel}</h2>
        </div>
        <FilterBar
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          monitoredOnly={monitoredOnly}
          setMonitoredOnly={setMonitoredOnly}
        />
      </div>

      {/* Error state */}
      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      {/* Calendar Views */}
      {calendarView === 'month' && (
        <MonthView currentDate={currentDate} events={filteredEvents} />
      )}
      {calendarView === 'week' && (
        <WeekView currentDate={currentDate} events={filteredEvents} />
      )}
      {calendarView === 'agenda' && <AgendaView events={filteredEvents} />}
    </div>
  );
}
