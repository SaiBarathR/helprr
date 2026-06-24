'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
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
  Disc3,
  Bookmark,
  Bell,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageSpinner } from '@/components/ui/page-spinner';
import {
  FinaleBadge,
  ReleaseTypeBadge,
  getMonthBorderClass,
} from '@/components/calendar/release-badges';
import { useCalendar } from '@/hooks/use-calendar';
import { useUIStore } from '@/lib/store';
import { InstanceFilter, deriveInstances } from '@/components/instance-filter';
import { ScheduledAlertButton } from '@/components/scheduled-alerts/scheduled-alert-dialog';
import type { ScheduledAlertDraft } from '@/lib/scheduled-alerts/types';
import type { CalendarEvent } from '@/types';

/** Detail-page link for a calendar event, by media type. Carries the owning
 * instance so a non-default-instance item opens the correct instance. */
function eventHref(event: CalendarEvent): string {
  if (event.href) return event.href;
  const q = event.instanceId ? `?instance=${event.instanceId}` : '';
  if (event.type === 'episode' && event.seriesId != null) return `/series/${event.seriesId}${q}`;
  if (event.type === 'album' && event.albumId != null) return `/music/album/${event.albumId}${q}`;
  if (event.movieId != null) return `/movies/${event.movieId}${q}`;
  return '/notifications/scheduled';
}

function posterFromEvent(event: CalendarEvent): string | null {
  const img = event.images?.find((i) => i.coverType === 'poster');
  return img?.remoteUrl ?? img?.url ?? null;
}

function scheduleDraftFromEvent(event: CalendarEvent): ScheduledAlertDraft | null {
  const q = event.instanceId ? `?instance=${event.instanceId}` : '';
  if (event.type === 'episode' && event.seriesId) {
    return {
      source: 'SONARR',
      externalId: String(event.seriesId),
      mediaType: 'series',
      title: event.title,
      subtitle: event.subtitle,
      posterUrl: posterFromEvent(event),
      instanceId: event.instanceId ?? null,
      href: `/series/${event.seriesId}${q}`,
      releaseDate: event.date,
    };
  }
  if (event.type === 'movie' && event.movieId) {
    return {
      source: 'RADARR',
      externalId: String(event.movieId),
      mediaType: 'movie',
      title: event.title,
      subtitle: event.subtitle,
      posterUrl: posterFromEvent(event),
      instanceId: event.instanceId ?? null,
      href: `/movies/${event.movieId}${q}`,
      releaseDate: event.date,
    };
  }
  return null;
}

/**
 * Render a compact set of filter controls used by the calendar header.
 *
 * @param typeFilter - Currently selected content type: `'all'`, `'episode'`, or `'movie'`.
 * @param setTypeFilter - Callback invoked with a new content type when the user selects a type button.
 * @param monitoredOnly - When true, the UI shows only monitored items.
 * @param setMonitoredOnly - Callback invoked with the new monitored-only state when the user toggles the monitored control.
 * @returns The compact filter bar element containing type buttons and a monitored toggle.
 */

function CompactFilters({
  typeFilter,
  setTypeFilter,
  monitoredOnly,
  setMonitoredOnly,
  showScheduled,
  setShowScheduled,
}: {
  typeFilter: 'all' | 'episode' | 'movie' | 'album';
  setTypeFilter: (v: 'all' | 'episode' | 'movie' | 'album') => void;
  monitoredOnly: boolean;
  setMonitoredOnly: (v: boolean) => void;
  showScheduled: boolean;
  setShowScheduled: (v: boolean) => void;
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
      <button
        onClick={() => setTypeFilter('album')}
        className={`p-1.5 rounded-md transition-colors ${typeFilter === 'album'
          ? 'bg-emerald-500/15 text-emerald-400'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        title="Music"
      >
        <Disc3 className="h-3.5 w-3.5" />
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

      <div className="w-px h-4 bg-border/50 mx-0.5" />

      <button
        onClick={() => setShowScheduled(!showScheduled)}
        className={`p-1.5 rounded-md transition-colors ${showScheduled
          ? 'bg-violet-500/15 text-violet-400'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        title={showScheduled ? 'Showing scheduled alerts' : 'Hiding scheduled alerts'}
      >
        <Bell className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Render an agenda-style list of calendar events grouped by day.
 *
 * Groups the provided events by their calendar date and renders each day with a
 * compact date header (weekday, day, month) and a list of event rows. Each row
 * links to the event's detail page (series or movie), shows an icon for type,
 * title, subtitle, time, and a monitored indicator. Events that are not
 * monitored or that have a file are visually muted.
 *
 * @param events - Array of CalendarEvent objects to display; events are grouped by date (`yyyy-MM-dd`) for rendering.
 * @returns A JSX element containing the grouped agenda view.
 */

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
          const href = eventHref(event);
          const eventDate = new Date(event.date);
          const scheduleDraft =
            event.origin !== 'scheduled' ? scheduleDraftFromEvent(event) : null;

          return (
            <div
              key={event.id}
              data-agenda-date={isFirstOfDay ? dateKey : undefined}
              className="flex items-start gap-1 border-b border-border/30"
            >
              <Link href={href} className="flex flex-1 min-w-0 active:bg-muted/30">
                <div
                  className={`flex items-start gap-4 py-3 px-1 w-full ${!event.monitored ? 'opacity-50' : ''
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
                      ) : event.type === 'album' ? (
                        <Disc3 className="h-3 w-3 text-emerald-400 shrink-0" />
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
                  <div className="flex items-center gap-1.5 mt-0.5 pl-[18px]">
                    {event.releaseType && <ReleaseTypeBadge type={event.releaseType} />}
                    {event.finaleType && <FinaleBadge type={event.finaleType} />}
                    {(event.origin === 'scheduled' || event.scheduleLabel) && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 shrink-0">
                        Scheduled
                      </Badge>
                    )}
                    <p className="text-xs text-muted-foreground truncate min-w-0">
                      {event.subtitle}
                    </p>
                  </div>
                </div>

                {/* Monitored indicator */}
                {event.monitored && (
                  <Bookmark className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 mt-0.5" />
                )}
              </div>
              </Link>
              {scheduleDraft && (
                <div className="shrink-0 pt-3 pr-1">
                  <ScheduledAlertButton draft={scheduleDraft} />
                </div>
              )}
            </div>
          );
        });
      })}
    </div>
  );
}

/**
 * Render a month calendar grid showing each day of the month (with surrounding week padding) and up to three events per day.
 *
 * Days outside the current month are visually muted; the current day is highlighted. Each event is rendered as a link (series or movie) with styling that reflects its type, monitored state, and whether a file exists. If a day has more than three events, a “+N more” indicator is shown.
 *
 * @param currentDate - Reference date used to determine which month is displayed.
 * @param events - Array of calendar events to display; events are shown on their respective calendar day.
 * @returns A React element containing the month view grid.
 */

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
                  const href = eventHref(event);
                  const accentKey = event.releaseType ?? event.finaleType;
                  const accent = getMonthBorderClass(accentKey);
                  return (
                    <Link key={event.id} href={href} className="block">
                      <div
                        className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] leading-tight font-medium truncate transition-opacity hover:opacity-80 ${event.type === 'episode'
                          ? 'bg-blue-500/15 text-blue-400'
                          : event.type === 'album'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-orange-500/15 text-orange-400'
                          } ${accent} ${!event.monitored ? 'opacity-50' : ''} ${event.hasFile ? 'line-through decoration-1' : ''
                          }`}
                      >
                        {event.origin === 'scheduled' || event.scheduleLabel ? (
                          <Bell className="h-2 w-2 shrink-0" />
                        ) : event.type === 'episode' ? (
                          <Tv className="h-2 w-2 shrink-0" />
                        ) : event.type === 'album' ? (
                          <Disc3 className="h-2 w-2 shrink-0" />
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

/**
 * Render a seven-day week view anchored to a given date, listing events grouped by day.
 *
 * @param currentDate - A date within the week to display (week starts on Monday).
 * @param events - Array of CalendarEvent objects to show; events are grouped by their calendar day.
 * @returns The React element representing the week view with one card per day and event rows or a "No events" placeholder.
 */

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
            data-week-date={format(day, 'yyyy-MM-dd')}
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
                  const href = eventHref(event);
                  return (
                    <Link key={event.id} href={href} className="block">
                      <div
                        className={`flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/30 active:bg-muted/50 ${!event.monitored ? 'opacity-50' : ''
                          }`}
                      >
                        {event.type === 'episode' ? (
                          <Tv className="h-3 w-3 text-blue-400 shrink-0" />
                        ) : event.type === 'album' ? (
                          <Disc3 className="h-3 w-3 text-emerald-400 shrink-0" />
                        ) : (
                          <Film className="h-3 w-3 text-orange-400 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p
                              className={`text-sm font-medium truncate ${event.hasFile
                                ? 'line-through text-muted-foreground'
                                : ''
                                }`}
                            >
                              {event.title}
                            </p>
                            {event.releaseType && <ReleaseTypeBadge type={event.releaseType} />}
                            {event.finaleType && <FinaleBadge type={event.finaleType} />}
                            {(event.origin === 'scheduled' || event.scheduleLabel) && (
                              <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 shrink-0">
                                Scheduled
                              </Badge>
                            )}
                          </div>
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

// ─── View Tabs (compact pill style) ─────────────────────────────────────────

type ViewType = 'agenda' | 'month' | 'week';

/**
 * Renders a compact tab control for selecting the calendar view.
 *
 * @param value - The currently selected view (`'agenda' | 'week' | 'month'`).
 * @param onChange - Callback invoked with the newly selected view when a tab is clicked.
 */
function ViewTabs({
  value,
  onChange,
  views,
}: {
  value: ViewType;
  onChange: (v: ViewType) => void;
  views: { key: ViewType; label: string }[];
}) {
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

/**
 * Render the calendar page with controls, navigation, and three view modes: agenda, month, and week.
 *
 * Fetches events for the currently selected date range and type filter, applies an optional monitored-only
 * client-side filter, and displays loading and error states. Provides navigation (back, forward, today)
 * and UI controls for switching views and filters.
 *
 * @returns The rendered calendar page element
 */

export default function CalendarPage() {
  const calendarView = useUIStore((s) => s.calendarView);
  const setCalendarView = useUIStore((s) => s.setCalendarView);
  const typeFilter = useUIStore((s) => s.calendarTypeFilter);
  const setTypeFilter = useUIStore((s) => s.setCalendarTypeFilter);
  const monitoredOnly = useUIStore((s) => s.calendarMonitoredOnly);
  const setMonitoredOnly = useUIStore((s) => s.setCalendarMonitoredOnly);
  const instanceFilter = useUIStore((s) => s.calendarInstanceFilter);
  const setInstanceFilter = useUIStore((s) => s.setCalendarInstanceFilter);
  const showScheduled = useUIStore((s) => s.calendarShowScheduled);
  const setShowScheduled = useUIStore((s) => s.setCalendarShowScheduled);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [isMobile, setIsMobile] = useState(false);
  const autoFocusPendingRef = useRef(true);
  const autoFocusWaitForLoadRef = useRef(true);
  const autoFocusSawLoadingRef = useRef(false);
  const lastViewRef = useRef<ViewType | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(media.matches);

    update();

    if (media.addEventListener) {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    if (isMobile && calendarView === 'month') {
      autoFocusPendingRef.current = true;
      autoFocusWaitForLoadRef.current = true;
      autoFocusSawLoadingRef.current = false;
      setCalendarView('agenda');
    }
  }, [isMobile, calendarView, setCalendarView]);

  useEffect(() => {
    if (lastViewRef.current !== calendarView) {
      if (calendarView === 'agenda' || calendarView === 'week') {
        autoFocusPendingRef.current = true;
        autoFocusWaitForLoadRef.current = true;
        autoFocusSawLoadingRef.current = false;
      }
      lastViewRef.current = calendarView;
    }
  }, [calendarView]);

  const availableViews = useMemo<{ key: ViewType; label: string }[]>(() => {
    if (isMobile) {
      return [
        { key: 'agenda', label: 'Agenda' },
        { key: 'week', label: 'Week' },
      ];
    }

    return [
      { key: 'agenda', label: 'Agenda' },
      { key: 'week', label: 'Week' },
      { key: 'month', label: 'Month' },
    ];
  }, [isMobile]);

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
    includeScheduled: showScheduled,
  });

  // Instances present in the loaded events (drives the instance-filter dropdown).
  const instances = useMemo(() => deriveInstances(events), [events]);

  // Drop a stale instance selection if that instance is no longer present.
  useEffect(() => {
    if (instanceFilter !== 'all' && !instances.some((i) => i.id === instanceFilter)) {
      setInstanceFilter('all');
    }
  }, [instances, instanceFilter, setInstanceFilter]);

  // Apply monitored + instance filters client-side.
  const filteredEvents = useMemo(() => {
    let list = events;
    if (monitoredOnly) list = list.filter((e) => e.monitored);
    if (instanceFilter !== 'all') list = list.filter((e) => e.instanceId === instanceFilter);
    if (!showScheduled) list = list.filter((e) => e.origin !== 'scheduled' && !e.scheduleLabel);
    return list;
  }, [events, monitoredOnly, instanceFilter, showScheduled]);

  const agendaTargetDateKey = useMemo(() => {
    if (filteredEvents.length === 0) return undefined;

    const dayKeys = Array.from(
      new Set(filteredEvents.map((event) => format(new Date(event.date), 'yyyy-MM-dd')))
    ).sort((a, b) => a.localeCompare(b));

    const todayKey = format(new Date(), 'yyyy-MM-dd');
    if (dayKeys.includes(todayKey)) return todayKey;

    return dayKeys.find((key) => key > todayKey);
  }, [filteredEvents]);

  useEffect(() => {
    if (!autoFocusPendingRef.current) return;

    if (autoFocusWaitForLoadRef.current) {
      if (loading) {
        autoFocusSawLoadingRef.current = true;
        return;
      }
      if (!autoFocusSawLoadingRef.current) return;
    } else if (loading) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      let done = false;

      if (calendarView === 'agenda') {
        if (!agendaTargetDateKey) {
          done = true;
        } else {
          const target = document.querySelector<HTMLElement>(
            `[data-agenda-date="${agendaTargetDateKey}"]`
          );
          if (target) {
            target.scrollIntoView({ behavior: 'instant', block: 'start' });
            done = true;
          }
        }
      } else if (calendarView === 'week') {
        const todayKey = format(new Date(), 'yyyy-MM-dd');
        const target = document.querySelector<HTMLElement>(
          `[data-week-date="${todayKey}"]`
        );
        if (target) {
          target.scrollIntoView({ behavior: 'instant', block: 'start' });
          done = true;
        } else {
          const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
          const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
          const now = new Date();
          if (now < weekStart || now > weekEnd) {
            done = true;
          }
        }
      }

      if (done) {
        autoFocusPendingRef.current = false;
        autoFocusWaitForLoadRef.current = false;
        autoFocusSawLoadingRef.current = false;
      }
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [loading, calendarView, agendaTargetDateKey, currentDate]);

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
    if (calendarView === 'agenda' || calendarView === 'week') {
      autoFocusPendingRef.current = true;
      autoFocusWaitForLoadRef.current = false;
      autoFocusSawLoadingRef.current = false;
    }
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
    <div className="space-y-3 animate-content-in">
      <div className="sticky z-30 -mx-2 px-2 pt-1 pb-2 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80 md:-mx-6 md:px-6 space-y-2" style={{ top: 'var(--header-height, 0px)' }}>
        {/* Top bar: title + view tabs */}
        <div className="flex items-center justify-between md:hidden">
          <ViewTabs
            value={calendarView}
            views={availableViews}
            onChange={(v) => setCalendarView(v)}
          />
          <div className="flex items-center gap-2">
            <InstanceFilter instances={instances} value={instanceFilter} onChange={setInstanceFilter} />
            <CompactFilters
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              monitoredOnly={monitoredOnly}
              setMonitoredOnly={setMonitoredOnly}
              showScheduled={showScheduled}
              setShowScheduled={setShowScheduled}
            />
          </div>
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
              views={availableViews}
              onChange={(v) => setCalendarView(v)}
            />
            <InstanceFilter instances={instances} value={instanceFilter} onChange={setInstanceFilter} />
            <CompactFilters
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              monitoredOnly={monitoredOnly}
              setMonitoredOnly={setMonitoredOnly}
              showScheduled={showScheduled}
              setShowScheduled={setShowScheduled}
            />
          </div>

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

      {/* Loading state — only on the true first load; a range/type change keeps
          the previous grid up (events stay in state) while the new range loads. */}
      {loading && events.length === 0 && <PageSpinner />}

      {/* Calendar views — render whenever the fetch has settled (so a genuinely
          empty range still shows its "No events" placeholder) or we already have
          events to keep on screen during a background refetch. */}
      {(!loading || events.length > 0) && (
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
