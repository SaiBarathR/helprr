'use client';

import { ChevronLeft, ChevronRight, CalendarClock } from 'lucide-react';

interface AnimeScheduleWeekNavProps {
  weekStart: Date;
  weekEnd: Date;
  totalCount: number;
  isCurrentWeek: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

function formatRange(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const fmtMonthDay = (d: Date) =>
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const fmtDay = (d: Date) =>
    d.toLocaleDateString(undefined, { day: 'numeric' });
  const fmtYear = end.getFullYear();

  if (sameMonth) {
    return `${fmtMonthDay(start)} – ${fmtDay(end)}, ${fmtYear}`;
  }
  if (sameYear) {
    return `${fmtMonthDay(start)} – ${fmtMonthDay(end)}, ${fmtYear}`;
  }
  return `${fmtMonthDay(start)}, ${start.getFullYear()} – ${fmtMonthDay(end)}, ${end.getFullYear()}`;
}

export function AnimeScheduleWeekNav({
  weekStart,
  weekEnd,
  totalCount,
  isCurrentWeek,
  onPrev,
  onNext,
  onToday,
}: AnimeScheduleWeekNavProps) {
  return (
    <div
      className="page-toolbar py-3 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/40"
      style={{ top: 'var(--header-height, 0px)' }}
    >
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <CalendarClock className="h-4 w-4 shrink-0 text-amber-400/80" />
          <div className="min-w-0">
            <p className="text-[9.5px] sm:text-[10px] tracked-caps text-muted-foreground/80 leading-none">
              {isCurrentWeek ? 'This Week' : 'Schedule'}
            </p>
            <p className="font-display text-sm sm:text-base font-semibold leading-tight truncate">
              {formatRange(weekStart, weekEnd)}
            </p>
          </div>
          {totalCount > 0 && (
            <span className="ml-1 font-mono tabular-nums shrink-0 inline-flex items-center rounded-sm border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {totalCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous week"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/40 bg-card/40 text-muted-foreground hover:text-foreground hover:border-border transition-colors press-feedback"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToday}
            disabled={isCurrentWeek}
            className="inline-flex h-8 items-center rounded-md border border-border/40 bg-card/40 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors press-feedback disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next week"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/40 bg-card/40 text-muted-foreground hover:text-foreground hover:border-border transition-colors press-feedback"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
