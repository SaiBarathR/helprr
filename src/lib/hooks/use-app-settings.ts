'use client';

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
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
  notificationGroupingEnabled: boolean;
  animeAutoMapEnabled: boolean;
  animeAutoMapHour: number;
  anilistSectionsTtlMin: number;
  anilistBrowseTtlMin: number;
  anilistDetailTtlMin: number;
  anilistAiringTtlMin: number;
}

export type AppSettingsPatch = Partial<Omit<AppSettingsState, 'envTimeZone'>>;

const SETTINGS_KEY = ['settings'] as const;

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

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
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
    notificationGroupingEnabled: raw.notificationGroupingEnabled !== false,
    animeAutoMapEnabled: raw.animeAutoMapEnabled !== false,
    animeAutoMapHour: numberOr(raw.animeAutoMapHour, 0),
    anilistSectionsTtlMin: numberOr(raw.anilistSectionsTtlMin, 5),
    anilistBrowseTtlMin: numberOr(raw.anilistBrowseTtlMin, 10),
    anilistDetailTtlMin: numberOr(raw.anilistDetailTtlMin, 1440),
    anilistAiringTtlMin: numberOr(raw.anilistAiringTtlMin, 10),
  };
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

// Backed by TanStack Query: a single ['settings'] cache shared across every
// consumer (replacing the module singleton + listener set + in-flight dedup).
// `update` keeps the optimistic-write + rollback + toast/successMessage contract.
export function useAppSettings(): UseAppSettingsResult {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async ({ signal }) =>
      normalize(await jsonFetcher<Record<string, unknown>>('/api/settings')({ signal })),
    staleTime: 5 * 60_000,
  });

  const { mutateAsync } = useMutation({
    // Serialize concurrent saves app-wide (restores the old updateChain guarantee):
    // mutations sharing a scope id run in series, so a second update() stays paused
    // until the first settles. Its onMutate then reads the reconciled cache, and
    // out-of-order PUT responses can't clobber each other.
    scope: { id: 'app-settings' },
    mutationFn: async (patch: AppSettingsPatch) => {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const payload = await res.json().catch(() => null);
      // ApiError (not plain Error) so a 401 carries its status to the global
      // MutationCache handler and redirects to /login instead of just toasting.
      if (!res.ok) throw new ApiError(res.status, payload?.error || 'Failed to save');
      return { state: normalize(payload ?? {}), raw: payload };
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: SETTINGS_KEY });
      const previous = qc.getQueryData<AppSettingsState>(SETTINGS_KEY);
      if (previous) qc.setQueryData<AppSettingsState>(SETTINGS_KEY, { ...previous, ...patch });
      return { previous };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(SETTINGS_KEY, ctx.previous);
    },
    onSuccess: ({ state }) => {
      qc.setQueryData(SETTINGS_KEY, state);
    },
  });

  const update = useCallback<UseAppSettingsResult['update']>(
    async (patch, opts) => {
      const showToast = opts?.toast !== false;
      try {
        const { state, raw } = await mutateAsync(patch);
        if (showToast) {
          let custom: string | undefined;
          try {
            custom = opts?.successMessage?.(state, raw);
          } catch (err) {
            console.error('[use-app-settings] successMessage callback threw', err);
          }
          if (custom) toast.success(custom, { duration: 1800 });
          else toast.success('Saved', { duration: 1200 });
        }
        return state;
      } catch (err) {
        if (showToast) toast.error(err instanceof Error ? err.message : 'Failed to save');
        return null;
      }
    },
    [mutateAsync],
  );

  const reload = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: SETTINGS_KEY });
  }, [qc]);

  return {
    settings: query.data ?? null,
    loading: query.isLoading,
    update,
    reload,
  };
}
