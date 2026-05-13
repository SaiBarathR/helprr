'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PageSpinner } from '@/components/ui/page-spinner';
import { AnimeScheduleCard } from '@/components/anime/anime-schedule-card';
import { AnimeScheduleWeekNav } from '@/components/anime/anime-schedule-week-nav';
import type { AniListScheduleEntry } from '@/types/anilist';
import type { DiscoverLibraryStatus } from '@/types';

type EntryWithLibrary = AniListScheduleEntry & { library?: DiscoverLibraryStatus };

interface ScheduleResponse {
  weekStart: number;
  weekEnd: number;
  entries: EntryWithLibrary[];
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Returns the local-time Monday-00:00 for the week containing `date`. */
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return d;
}

function endOfWeek(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 7);
  d.setSeconds(d.getSeconds() - 1); // Sun 23:59:59
  return d;
}

function unixSec(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

interface DayBucket {
  date: Date;
  dayName: string;
  isToday: boolean;
  isPast: boolean;
  entries: EntryWithLibrary[];
}

function buildDayBuckets(weekStart: Date, entries: EntryWithLibrary[]): DayBucket[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const buckets: DayBucket[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    buckets.push({
      date: d,
      dayName: DAY_NAMES[d.getDay()],
      isToday: sameLocalDay(d, today),
      isPast: d.getTime() < today.getTime(),
      entries: [],
    });
  }

  for (const entry of entries) {
    const airing = new Date(entry.airingAt * 1000);
    airing.setHours(0, 0, 0, 0);
    const idx = buckets.findIndex((b) => sameLocalDay(b.date, airing));
    if (idx >= 0) {
      buckets[idx].entries.push(entry);
    }
  }
  for (const bucket of buckets) {
    bucket.entries.sort((a, b) => a.airingAt - b.airingAt);
  }
  return buckets;
}

export default function AnimeSchedulePage() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [entries, setEntries] = useState<EntryWithLibrary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));
  const lastFetchKey = useRef<string>('');

  const weekEnd = useMemo(() => endOfWeek(weekStart), [weekStart]);
  const currentWeekStart = useMemo(() => startOfWeek(new Date()), []);
  const isCurrentWeek = sameLocalDay(weekStart, currentWeekStart);

  const load = useCallback(async (start: Date, end: Date) => {
    const key = `${unixSec(start)}-${unixSec(end)}`;
    if (lastFetchKey.current === key) return;
    lastFetchKey.current = key;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        weekStart: String(unixSec(start)),
        weekEnd: String(unixSec(end)),
      });
      const res = await fetch(`/api/anime/schedule?${params.toString()}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Failed to load schedule');
      }
      const data: ScheduleResponse = await res.json();
      setEntries(data.entries || []);
      setNow(Math.floor(Date.now() / 1000));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load schedule';
      setError(message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(weekStart, weekEnd);
  }, [weekStart, weekEnd, load]);

  // Tick "now" each minute so past/upcoming styling stays accurate.
  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 60_000);
    return () => window.clearInterval(tick);
  }, []);

  const handlePrev = useCallback(() => {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() - 7);
      return next;
    });
  }, []);

  const handleNext = useCallback(() => {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + 7);
      return next;
    });
  }, []);

  const handleToday = useCallback(() => {
    setWeekStart(startOfWeek(new Date()));
  }, []);

  const buckets = useMemo(() => buildDayBuckets(weekStart, entries), [weekStart, entries]);

  return (
    <div className="animate-content-in">
      <Link
        href="/anime"
        className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground transition-colors pt-2 pb-1"
      >
        <ChevronLeft className="h-4 w-4" />
        Anime
      </Link>

      <AnimeScheduleWeekNav
        weekStart={weekStart}
        weekEnd={weekEnd}
        totalCount={entries.length}
        isCurrentWeek={isCurrentWeek}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
      />

      {loading && entries.length === 0 ? (
        <PageSpinner />
      ) : error ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {error}
        </div>
      ) : (
        <div className="pt-4 pb-12 space-y-6">
          {buckets.map((bucket) => (
            <DaySection key={bucket.date.toISOString()} bucket={bucket} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

function DaySection({ bucket, now }: { bucket: DayBucket; now: number }) {
  const monthDay = bucket.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <section
      className={bucket.isPast && !bucket.isToday ? 'opacity-60' : ''}
      aria-label={`${bucket.dayName} ${monthDay}`}
    >
      <header className="flex items-baseline gap-3 pb-3 border-b border-border/40 mb-3">
        <h2
          className={`font-display text-xl sm:text-2xl font-semibold leading-none ${
            bucket.isToday ? 'text-amber-300' : ''
          }`}
        >
          {bucket.dayName}
        </h2>
        <p className="text-xs sm:text-sm text-muted-foreground tracked-caps">
          {monthDay}
        </p>
        {bucket.isToday && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-sm border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] tracked-caps text-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            Today
          </span>
        )}
        {!bucket.isToday && bucket.entries.length > 0 && (
          <span className="ml-auto font-mono tabular-nums text-[10px] text-muted-foreground/70">
            {bucket.entries.length}
          </span>
        )}
      </header>

      {bucket.entries.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 italic px-1">
          No airings
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-2.5">
          {bucket.entries.map((entry) => (
            <AnimeScheduleCard
              key={`${entry.media.id}-${entry.episode}-${entry.airingAt}`}
              entry={entry}
              now={now}
            />
          ))}
        </div>
      )}
    </section>
  );
}
