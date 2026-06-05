'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { normalizeRegionCode } from '@/lib/region';

export interface AppSettingsState {
  pollingIntervalSecs: number;
  activityRefreshIntervalSecs: number;
  torrentsRefreshIntervalSecs: number;
  cacheImagesEnabled: boolean;
  timeZone: string;
  envTimeZone: string;
  logEnabled: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logMaxFileMb: number;
  logRetentionDays: number;
  notificationHistoryRetentionDays: number;
  logClientConsoleEnabled: boolean;
  logFailedRequestBodies: boolean;
  logFailedResponseBodies: boolean;
  upcomingNotifyMode: 'before_air' | 'daily_digest';
  upcomingNotifyBeforeMins: number;
  upcomingDailyNotifyHour: number;
  watchProviderRegion: string;
  activityDigestMode: 'off' | 'daily' | 'weekly';
  activityDigestHour: number;
  activityDigestDayOfWeek: number;
}

export type AppSettingsPatch = Partial<Omit<AppSettingsState, 'envTimeZone'>>;

type SettingsListener = (state: AppSettingsState | null) => void;

let cachedState: AppSettingsState | null = null;
let inflightLoad: Promise<AppSettingsState | null> | null = null;
let updateChain: Promise<unknown> = Promise.resolve();
const listeners = new Set<SettingsListener>();

function notify() {
  for (const listener of listeners) listener(cachedState);
}

async function fetchSettings(): Promise<AppSettingsState | null> {
  if (cachedState) return cachedState;
  if (inflightLoad) return inflightLoad;
  inflightLoad = (async () => {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) {
        console.error('[use-app-settings] fetch failed', res.status, res.statusText);
        cachedState = null;
        notify();
        return null;
      }
      const data = await res.json();
      cachedState = normalize(data);
      notify();
      return cachedState;
    } catch (err) {
      console.error('[use-app-settings] fetch failed', err);
      cachedState = null;
      notify();
      return null;
    } finally {
      inflightLoad = null;
    }
  })();
  return inflightLoad;
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const UPCOMING_NOTIFY_MODES = ['before_air', 'daily_digest'] as const;
const ACTIVITY_DIGEST_MODES = ['off', 'daily', 'weekly'] as const;

function pickEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
}

function normalize(raw: Record<string, unknown>): AppSettingsState {
  return {
    pollingIntervalSecs: numberOr(raw.pollingIntervalSecs, 30),
    activityRefreshIntervalSecs: numberOr(raw.activityRefreshIntervalSecs, 5),
    torrentsRefreshIntervalSecs: numberOr(raw.torrentsRefreshIntervalSecs, 5),
    cacheImagesEnabled: raw.cacheImagesEnabled !== false,
    timeZone: typeof raw.timeZone === 'string' ? raw.timeZone : 'UTC',
    envTimeZone: typeof raw.envTimeZone === 'string' ? raw.envTimeZone : 'UTC',
    logEnabled: raw.logEnabled !== false,
    logLevel: pickEnum(raw.logLevel, LOG_LEVELS, 'debug'),
    logMaxFileMb: numberOr(raw.logMaxFileMb, 50),
    logRetentionDays: numberOr(raw.logRetentionDays, 30),
    notificationHistoryRetentionDays: numberOr(raw.notificationHistoryRetentionDays, 90),
    logClientConsoleEnabled: raw.logClientConsoleEnabled !== false,
    logFailedRequestBodies: Boolean(raw.logFailedRequestBodies),
    logFailedResponseBodies: Boolean(raw.logFailedResponseBodies),
    upcomingNotifyMode: pickEnum(raw.upcomingNotifyMode, UPCOMING_NOTIFY_MODES, 'before_air'),
    upcomingNotifyBeforeMins: numberOr(raw.upcomingNotifyBeforeMins, 60),
    upcomingDailyNotifyHour: numberOr(raw.upcomingDailyNotifyHour, 9),
    watchProviderRegion: normalizeRegionCode(raw.watchProviderRegion) ?? 'US',
    activityDigestMode: pickEnum(raw.activityDigestMode, ACTIVITY_DIGEST_MODES, 'off'),
    activityDigestHour: numberOr(raw.activityDigestHour, 8),
    activityDigestDayOfWeek: numberOr(raw.activityDigestDayOfWeek, 1),
  };
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export interface UpdateOptions {
  /** When false, suppresses the inline saved/error toast. */
  toast?: boolean;
  /**
   * Optional callback to override the default "Saved" toast text. Receives the
   * post-update normalized state and the raw PUT response payload (which may
   * include transient fields like `cachePurge` that are not part of state).
   * Return a string to use as the toast message, or undefined to fall through
   * to the default.
   */
  successMessage?: (state: AppSettingsState, raw: unknown) => string | undefined;
}

export interface UseAppSettingsResult {
  settings: AppSettingsState | null;
  loading: boolean;
  update: (patch: AppSettingsPatch, opts?: UpdateOptions) => Promise<AppSettingsState | null>;
  reload: () => Promise<void>;
}

export function useAppSettings(): UseAppSettingsResult {
  const [settings, setSettings] = useState<AppSettingsState | null>(cachedState);
  const [loading, setLoading] = useState<boolean>(cachedState === null);

  useEffect(() => {
    const listener: SettingsListener = (next) => setSettings(next);
    listeners.add(listener);
    if (cachedState === null) {
      void fetchSettings().finally(() => setLoading(false));
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const update = useCallback<UseAppSettingsResult['update']>((patch, opts) => {
    const run = updateChain.then(async () => {
      const showToast = opts?.toast !== false;
      const previous = cachedState;
      if (previous) {
        cachedState = { ...previous, ...patch };
        notify();
      }

      try {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          cachedState = previous;
          notify();
          if (showToast) toast.error(payload?.error || 'Failed to save');
          return null;
        }
        cachedState = normalize(payload ?? {});
        notify();
        if (showToast) {
          let custom: string | undefined;
          try {
            custom = opts?.successMessage?.(cachedState, payload);
          } catch (err) {
            console.error('[use-app-settings] successMessage callback threw', err);
          }
          if (custom) toast.success(custom, { duration: 1800 });
          else toast.success('Saved', { duration: 1200 });
        }
        return cachedState;
      } catch {
        cachedState = previous;
        notify();
        if (showToast) toast.error('Failed to save');
        return null;
      }
    });
    updateChain = run.catch(() => {});
    return run;
  }, []);

  const reload = useCallback(async () => {
    cachedState = null;
    inflightLoad = null;
    notify();
    await fetchSettings();
  }, []);

  return { settings, loading, update, reload };
}
