'use client';

import { useState, useMemo, useEffect, useRef, type ReactElement } from 'react';
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
  Image as ImageIcon,
  ImageOff,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FinaleBadge,
  ReleaseTypeBadge,
  getMonthBorderClass,
} from '@/components/calendar/release-badges';
import { useCalendar } from '@/hooks/use-calendar';
import { useUIStore } from '@/lib/store';
import { InstanceFilter, deriveInstances } from '@/components/instance-filter';
import { ScheduledAlertButton } from '@/components/scheduled-alerts/scheduled-alert-dialog';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
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

/** Wide artwork for the mobile row backdrop (fanart, falling back to banner
 *  or album cover). Distinct from the poster so the crop suits a short row. */
function backdropFromEvent(event: CalendarEvent): string | null {
  const images = event.images ?? [];
  const img =
    images.find((i) => i.coverType === 'fanart') ??
    images.find((i) => i.coverType === 'banner') ??
    images.find((i) => i.coverType === 'cover');
  return img?.remoteUrl ?? img?.url ?? null;
}

/** Artwork layer behind an event row: dimmed backdrop fading toward the text
 *  side so the row copy stays readable. Sits under content — the content
 *  siblings must be `relative` to paint above it. */
function RowBackdrop({ src }: { src: string | null }) {
  const imageOpacity = useUIStore((s) => s.calendarImageOpacity);
  if (!src) return null;
  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
        style={{ opacity: imageOpacity / 100 }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-background/40" />
    </div>
  );
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

function CalendarEventContext({
  event,
  children,
  onOpenChange,
}: {
  event: CalendarEvent;
  children: ReactElement;
  onOpenChange?: (open: boolean) => void;
}) {
  const href = eventHref(event);
  const scheduled = event.origin === 'scheduled' || Boolean(event.scheduleLabel);

  return (
    <>
      <QuickContextMenu
        label={`${event.title} calendar actions`}
        actions={[
          {
            id: 'open',
            label: 'Open details',
            icon: <Eye />,
            href,
          },
          ...(scheduled ? [{
            id: 'scheduled',
            label: 'Manage scheduled alerts',
            icon: <Bell />,
            href: '/notifications/scheduled',
          }] : []),
        ]}
        onOpenChange={onOpenChange}
      >
        {children}
      </QuickContextMenu>
    </>
  );
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
  showImages,
  setShowImages,
}: {
  typeFilter: 'all' | 'episode' | 'movie' | 'album';
  setTypeFilter: (v: 'all' | 'episode' | 'movie' | 'album') => void;
  monitoredOnly: boolean;
  setMonitoredOnly: (v: boolean) => void;
  showScheduled: boolean;
  setShowScheduled: (v: boolean) => void;
  showImages: boolean;
  setShowImages: (v: boolean) => void;
}) {
  const typeOptions = [
    { value: 'all', label: 'All types', icon: null },
    { value: 'episode', label: 'Episodes', icon: Tv },
    { value: 'movie', label: 'Movies', icon: Film },
    { value: 'album', label: 'Music', icon: Disc3 },
  ] as const;
  const currentType = typeOptions.find((o) => o.value === typeFilter) ?? typeOptions[0];
  const CurrentTypeIcon = currentType.icon;

  return (
    <div className="flex items-center gap-1">
      {/* Type filter — dropdown on mobile/tablet (like the instance filter),
          inline icon buttons from lg up. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="lg:hidden h-8 gap-1.5 px-2 sm:px-3"
            title={currentType.label}
          >
            {CurrentTypeIcon ? (
              <CurrentTypeIcon className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <span className="text-[10px] font-bold leading-none">ALL</span>
            )}
            <span className="hidden sm:inline max-w-[8rem] truncate">{currentType.label}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Type</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {typeOptions.map(({ value, label, icon: Icon }) => (
            <DropdownMenuCheckboxItem
              key={value}
              checked={typeFilter === value}
              onCheckedChange={() => setTypeFilter(value)}
            >
              {Icon && <Icon className="h-3.5 w-3.5 mr-1.5" />}
              {label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="hidden lg:flex items-center gap-1">
        <button
          onClick={() => setTypeFilter('all')}
          className={`p-1.5 pt-0 rounded-md transition-colors ${typeFilter === 'all'
            ? 'bg-muted text-foreground'
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
      </div>

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

      {/* Poster/backdrop visibility (agenda + week views) */}
      <button
        onClick={() => setShowImages(!showImages)}
        className={`p-1.5 rounded-md transition-colors ${showImages
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        title={showImages ? 'Showing artwork' : 'Artwork hidden'}
      >
        {showImages ? (
          <ImageIcon className="h-3.5 w-3.5" />
        ) : (
          <ImageOff className="h-3.5 w-3.5" />
        )}
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

function AgendaView({ events, showImages }: { events: CalendarEvent[]; showImages: boolean }) {
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
          const poster = posterFromEvent(event);

          return (
            <div
              key={event.id}
              data-agenda-date={isFirstOfDay ? dateKey : undefined}
              className="relative overflow-hidden flex items-start gap-1 border-b border-border/30"
            >
              {showImages && <RowBackdrop src={backdropFromEvent(event)} />}
              <CalendarEventContext event={event}>
              <Link href={href} className="relative flex flex-1 min-w-0 active:bg-muted/30">
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

                {/* Poster (desktop only — mobile relies on the row backdrop) */}
                {showImages && (
                  <div className="hidden md:block w-9 shrink-0">
                    {poster ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={poster}
                        alt=""
                        loading="lazy"
                        className="w-9 aspect-[2/3] rounded object-cover bg-muted/40"
                      />
                    ) : (
                      <div className="w-9 aspect-[2/3] rounded bg-muted/30" />
                    )}
                  </div>
                )}

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
              </CalendarEventContext>
              {scheduleDraft && (
                <div className="relative shrink-0 pt-3 pr-1">
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
 * Month view: a scannable grid plus an always-visible day panel.
 *
 * Every day cell is selectable; the panel under the grid (beside it on xl)
 * lists ALL of the selected day's events as full rows, so overflow is never a
 * dead end — on desktop cells show up to three chips and a "+N more" button
 * that selects the day, on mobile cells show type-colored dots and the panel
 * is the reading surface. Selection anchors to today (or the month's first
 * day with events) whenever the user navigates.
 */

/**
 * A single event chip in the month grid. On pointer hover (desktop) it opens a
 * read-only popover with the event's details — poster, subtitle, air time,
 * release/finale badges, monitored and download state. Tap/click still
 * navigates to the detail page, so touch behavior is unchanged.
 */
function MonthEventItem({ event, showImages }: { event: CalendarEvent; showImages: boolean }) {
  const [open, setOpen] = useState(false);
  const openTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(openTimer.current), []);

  const show = () => {
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(true), 150);
  };
  const hide = () => {
    window.clearTimeout(openTimer.current);
    setOpen(false);
  };

  const href = eventHref(event);
  const accentKey = event.releaseType ?? event.finaleType;
  const accent = getMonthBorderClass(accentKey);
  const eventDate = new Date(event.date);
  const poster = posterFromEvent(event);
  const scheduled = event.origin === 'scheduled' || Boolean(event.scheduleLabel);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <CalendarEventContext event={event} onOpenChange={(menuOpen) => { if (menuOpen) hide(); }}>
        <PopoverTrigger asChild>
          <Link
            href={href}
            className="block"
            onMouseEnter={show}
            onMouseLeave={hide}
            onClick={hide}
          >
          <div
            className={`flex items-center gap-1 rounded px-1.5 py-1 text-[10px] leading-tight font-medium truncate transition-opacity hover:opacity-80 ${event.type === 'episode'
              ? 'bg-blue-500/15 text-blue-400'
              : event.type === 'album'
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-orange-500/15 text-orange-400'
              } ${accent} ${!event.monitored ? 'opacity-50' : ''} ${event.hasFile ? 'line-through decoration-1' : ''
              }`}
          >
            {scheduled ? (
              <Bell className="h-2.5 w-2.5 shrink-0" />
            ) : event.type === 'episode' ? (
              <Tv className="h-2.5 w-2.5 shrink-0" />
            ) : event.type === 'album' ? (
              <Disc3 className="h-2.5 w-2.5 shrink-0" />
            ) : (
              <Film className="h-2.5 w-2.5 shrink-0" />
            )}
            <span className="truncate">{event.title}</span>
          </div>
          </Link>
        </PopoverTrigger>
      </CalendarEventContext>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-72 p-3 pointer-events-none"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex gap-3">
          {showImages && poster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={poster}
              alt=""
              loading="lazy"
              className="w-14 shrink-0 self-start rounded object-cover aspect-[2/3] bg-muted"
            />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-1.5">
              {event.type === 'episode' ? (
                <Tv className="h-3 w-3 text-blue-400 shrink-0" />
              ) : event.type === 'album' ? (
                <Disc3 className="h-3 w-3 text-emerald-400 shrink-0" />
              ) : (
                <Film className="h-3 w-3 text-orange-400 shrink-0" />
              )}
              <p className="text-sm font-semibold leading-tight line-clamp-2">{event.title}</p>
            </div>
            {event.subtitle && (
              <p className="text-xs text-muted-foreground line-clamp-2">{event.subtitle}</p>
            )}
            <p className="text-xs text-muted-foreground tabular-nums">
              {format(eventDate, 'EEE, MMM d · h:mm a')}
            </p>
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              {event.releaseType && <ReleaseTypeBadge type={event.releaseType} />}
              {event.finaleType && <FinaleBadge type={event.finaleType} />}
              {scheduled && (
                <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 shrink-0">
                  {event.scheduleLabel || 'Scheduled'}
                </Badge>
              )}
              {event.instanceLabel && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0">
                  {event.instanceLabel}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 pt-0.5 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Bookmark className={`h-3 w-3 ${event.monitored ? 'text-primary' : ''}`} />
                {event.monitored ? 'Monitored' : 'Not monitored'}
              </span>
              <span className={event.hasFile ? 'text-green-500' : ''}>
                {event.hasFile ? 'Downloaded' : 'Not downloaded'}
              </span>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Type/origin color for the mobile day-cell dots. */
function dotClass(event: CalendarEvent): string {
  if (event.origin === 'scheduled' || event.scheduleLabel) return 'bg-violet-400';
  if (event.type === 'episode') return 'bg-blue-400';
  if (event.type === 'album') return 'bg-emerald-400';
  return 'bg-orange-400';
}

/** A full event row inside the day panel: backdrop, poster, badges, time and
 *  the schedule-alert shortcut — the month view's readable surface. */
function DayEventRow({ event, showImages }: { event: CalendarEvent; showImages: boolean }) {
  const href = eventHref(event);
  const eventDate = new Date(event.date);
  const scheduleDraft = event.origin !== 'scheduled' ? scheduleDraftFromEvent(event) : null;
  const poster = posterFromEvent(event);

  return (
    <div className="relative overflow-hidden flex items-center gap-1 border-b border-border/30 last:border-b-0">
      {showImages && <RowBackdrop src={backdropFromEvent(event)} />}
      <CalendarEventContext event={event}>
        <Link
          href={href}
          className="relative flex flex-1 min-w-0 transition-colors hover:bg-muted/30 active:bg-muted/50"
        >
        <div
          className={`flex items-center gap-3 py-2.5 px-3 w-full ${!event.monitored ? 'opacity-50' : ''
            } ${event.hasFile ? 'opacity-60' : ''}`}
        >
          {showImages && (
            <div className="w-8 shrink-0">
              {poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={poster}
                  alt=""
                  loading="lazy"
                  className="w-8 aspect-[2/3] rounded object-cover bg-muted/40"
                />
              ) : (
                <div className="w-8 aspect-[2/3] rounded bg-muted/30" />
              )}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
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
            <div className="flex items-center gap-1.5 mt-0.5">
              {event.releaseType && <ReleaseTypeBadge type={event.releaseType} />}
              {event.finaleType && <FinaleBadge type={event.finaleType} />}
              {(event.origin === 'scheduled' || event.scheduleLabel) && (
                <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 shrink-0">
                  {event.scheduleLabel || 'Scheduled'}
                </Badge>
              )}
              <p className="text-xs text-muted-foreground truncate min-w-0">
                {event.subtitle}
              </p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
            {format(eventDate, 'h:mm a')}
          </span>
        </div>
        </Link>
      </CalendarEventContext>
      {scheduleDraft && (
        <div className="relative shrink-0 pr-2">
          <ScheduledAlertButton draft={scheduleDraft} />
        </div>
      )}
    </div>
  );
}

/** The day panel under (beside, on xl) the month grid: date header with a
 *  release count, then every event of the selected day — nothing hidden. */
function DayPanel({
  dateKey,
  events,
  showImages,
}: {
  dateKey: string;
  events: CalendarEvent[];
  showImages: boolean;
}) {
  const date = new Date(dateKey + 'T00:00:00');
  const today = isToday(date);

  return (
    <section
      className={`rounded-xl border overflow-hidden ${today ? 'border-primary/40' : 'border-border/40'
        }`}
    >
      <header className="flex items-baseline gap-2 px-3 py-2.5 border-b border-border/30 bg-muted/30">
        <h2 className="text-sm font-semibold">{format(date, 'EEEE, MMMM d')}</h2>
        {today && (
          <span className="text-[10px] font-medium text-primary uppercase tracking-wide">
            Today
          </span>
        )}
        {events.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {events.length} release{events.length === 1 ? '' : 's'}
          </span>
        )}
      </header>
      {events.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          No releases this day.
        </p>
      ) : (
        <div>
          {events.map((event) => (
            <DayEventRow key={event.id} event={event} showImages={showImages} />
          ))}
        </div>
      )}
    </section>
  );
}

function MonthView({
  currentDate,
  events,
  showImages,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  showImages: boolean;
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  // Events grouped by day in one pass (the grid reads this per cell).
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = format(new Date(event.date), 'yyyy-MM-dd');
      const list = map.get(key);
      if (list) list.push(event);
      else map.set(key, [event]);
    }
    return map;
  }, [events]);

  // Manual selection is tied to the currentDate identity it was made under,
  // so any navigation (prev/next/Today swaps the Date object) invalidates it
  // and the selection falls back to the derived default: today when the month
  // contains it, otherwise the month's first day with events.
  const [manualSelection, setManualSelection] = useState<{
    anchor: Date;
    key: string;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const defaultKey = useMemo(() => {
    if (isSameMonth(new Date(), currentDate)) return format(new Date(), 'yyyy-MM-dd');
    const monthPrefix = format(currentDate, 'yyyy-MM');
    return (
      Array.from(eventsByDay.keys())
        .filter((key) => key.startsWith(monthPrefix))
        .sort()[0] ?? null
    );
  }, [currentDate, eventsByDay]);

  const selectedKey =
    manualSelection && manualSelection.anchor === currentDate
      ? manualSelection.key
      : defaultKey;

  function selectDay(key: string) {
    setManualSelection({ anchor: currentDate, key });
    // The panel sits below the grid on small screens; nudge it into view.
    window.requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const selectedEvents = selectedKey ? eventsByDay.get(selectedKey) ?? [] : [];

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-4 xl:items-start">
      <div>
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

        <div className="grid grid-cols-7 rounded-lg overflow-hidden border-t border-l border-border/40">
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd');
            const dayEvents = eventsByDay.get(key) ?? [];
            const inMonth = isSameMonth(day, currentDate);
            const today = isToday(day);
            const selected = key === selectedKey;
            const overflow = dayEvents.length - 3;

            return (
              <div
                key={key}
                onClick={() => selectDay(key)}
                className={`min-h-[52px] md:min-h-[112px] border-r border-b border-border/40 p-1 md:p-1.5 cursor-pointer transition-colors ${!inMonth ? 'bg-muted/20' : ''
                  } ${today ? 'bg-primary/5' : ''} ${selected
                    ? 'ring-1 ring-inset ring-primary/60 bg-primary/[0.06]'
                    : 'hover:bg-muted/30'
                  }`}
              >
                <div className="flex justify-center md:justify-start">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      selectDay(key);
                    }}
                    className={`text-xs font-medium rounded-full ${today
                      ? 'text-primary font-bold'
                      : inMonth
                        ? 'text-foreground'
                        : 'text-muted-foreground/40'
                      }`}
                  >
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 ${today
                        ? 'bg-primary text-primary-foreground rounded-full text-[10px]'
                        : ''
                        }`}
                    >
                      {format(day, 'd')}
                    </span>
                    <span className="sr-only">
                      {format(day, 'MMMM d')}, {dayEvents.length} release
                      {dayEvents.length === 1 ? '' : 's'}
                    </span>
                  </button>
                </div>

                {/* Mobile: type-colored dots — the day panel below is the reading surface. */}
                {dayEvents.length > 0 && (
                  <div className="md:hidden mt-1 flex items-center justify-center gap-[3px]">
                    {dayEvents.slice(0, 4).map((event) => (
                      <span
                        key={event.id}
                        className={`h-1.5 w-1.5 rounded-full ${dotClass(event)} ${!event.monitored ? 'opacity-40' : ''
                          }`}
                      />
                    ))}
                    {dayEvents.length > 4 && (
                      <span className="text-[8px] leading-none text-muted-foreground">+</span>
                    )}
                  </div>
                )}

                {/* Desktop: readable chips; overflow selects the day instead of dead-ending. */}
                <div className="hidden md:block space-y-0.5 mt-0.5">
                  {dayEvents.slice(0, 3).map((event) => (
                    <MonthEventItem key={event.id} event={event} showImages={showImages} />
                  ))}
                  {overflow > 0 && (
                    <button
                      type="button"
                      onClick={() => selectDay(key)}
                      className="w-full text-left px-1.5 py-0.5 text-[10px] font-medium text-primary hover:underline"
                    >
                      +{overflow} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        ref={panelRef}
        className="mt-3 xl:mt-0 scroll-mt-24 xl:sticky xl:top-[calc(var(--header-height,0px)+6rem)]"
      >
        {selectedKey ? (
          <DayPanel dateKey={selectedKey} events={selectedEvents} showImages={showImages} />
        ) : (
          <div className="rounded-xl border border-border/40 px-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No releases in {format(currentDate, 'MMMM yyyy')}.
            </p>
          </div>
        )}
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
  showImages,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  showImages: boolean;
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
            className={`rounded-lg border overflow-hidden transition-colors ${today ? 'border-primary/40 bg-primary/5' : 'border-border/40'
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
                  const poster = posterFromEvent(event);
                  return (
                    <CalendarEventContext key={event.id} event={event}>
                    <Link href={href} className="relative block overflow-hidden">
                      {showImages && <RowBackdrop src={backdropFromEvent(event)} />}
                      <div
                        className={`relative flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/30 active:bg-muted/50 ${!event.monitored ? 'opacity-50' : ''
                          }`}
                      >
                        {/* Poster (desktop only — mobile relies on the row backdrop) */}
                        {showImages && (
                          <div className="hidden md:block w-7 shrink-0">
                            {poster ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={poster}
                                alt=""
                                loading="lazy"
                                className="w-7 aspect-[2/3] rounded object-cover bg-muted/40"
                              />
                            ) : (
                              <div className="w-7 aspect-[2/3] rounded bg-muted/30" />
                            )}
                          </div>
                        )}
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
                    </CalendarEventContext>
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

const CALENDAR_VIEWS: { key: ViewType; label: string }[] = [
  { key: 'agenda', label: 'Agenda' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

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
  const showImages = useUIStore((s) => s.calendarShowImages);
  const setShowImages = useUIStore((s) => s.setCalendarShowImages);

  const [currentDate, setCurrentDate] = useState(new Date());
  const autoFocusPendingRef = useRef(true);
  const autoFocusWaitForLoadRef = useRef(true);
  const autoFocusSawLoadingRef = useRef(false);
  const lastViewRef = useRef<ViewType | null>(null);

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
      <h1 className="sr-only">Calendar</h1>
      <div className="page-toolbar page-toolbar-flush pb-2 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 space-y-2">
        {/* Top bar: title + view tabs. Wraps so the filter cluster drops to
            its own line on narrow screens instead of overflowing. */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 md:hidden">
          <ViewTabs
            value={calendarView}
            views={CALENDAR_VIEWS}
            onChange={(v) => setCalendarView(v)}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <InstanceFilter instances={instances} value={instanceFilter} onChange={setInstanceFilter} />
            <CompactFilters
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              monitoredOnly={monitoredOnly}
              setMonitoredOnly={setMonitoredOnly}
              showScheduled={showScheduled}
              setShowScheduled={setShowScheduled}
              showImages={showImages}
              setShowImages={setShowImages}
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
          <div className="items-center justify-end hidden md:flex flex-wrap gap-2">
            <ViewTabs
              value={calendarView}
              views={CALENDAR_VIEWS}
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
              showImages={showImages}
              setShowImages={setShowImages}
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
            <AgendaView events={filteredEvents} showImages={showImages} />
          )}
          {calendarView === 'month' && (
            <MonthView currentDate={currentDate} events={filteredEvents} showImages={showImages} />
          )}
          {calendarView === 'week' && (
            <WeekView currentDate={currentDate} events={filteredEvents} showImages={showImages} />
          )}
        </>
      )}
    </div>
  );
}
