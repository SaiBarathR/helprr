'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from '@/components/ui/app-link';
import { Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { ResponsiveCombobox } from '@/components/ui/responsive-combobox';
import { GroupedSection } from '@/components/settings/grouped-section';
import { SubtitleAppearanceSection } from '@/components/settings/subtitle-appearance-section';
import { PlayerSection } from '@/components/settings/player-section';
import { DateTimeFormatSection } from '@/components/settings/date-time-format-section';
import { PersonalTimeZoneRow } from '@/components/settings/personal-time-zone-row';
import { hasCapability, useMe } from '@/components/permission-provider';
import { useAppSettings } from '@/lib/hooks/use-app-settings';
import { useDebouncedCommit } from '@/lib/hooks/use-debounced-commit';

interface RegionOption {
  code: string;
  name: string;
}

const REGION_FALLBACK: RegionOption[] = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'IN', name: 'India' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'JP', name: 'Japan' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
];

const POLLING_OPTIONS = [
  { value: '15', label: '15 seconds' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '60 seconds' },
  { value: '120', label: '120 seconds' },
];

const REFRESH_OPTIONS = [
  { value: '2', label: '2 seconds' },
  { value: '5', label: '5 seconds' },
  { value: '10', label: '10 seconds' },
  { value: '15', label: '15 seconds' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '1 minute' },
  { value: '120', label: '2 minutes' },
  { value: '300', label: '5 minutes' },
  { value: '600', label: '10 minutes' },
];

export default function PreferencesPage() {
  const { settings, loading, update } = useAppSettings();
  const me = useMe();
  const isAdmin = me?.role === 'admin';
  const [draft, setDraft] = useState<string | null>(null);
  const displayedTz = draft ?? settings?.timeZone ?? '';

  const [regions, setRegions] = useState<RegionOption[] | null>(null);
  const [regionOpen, setRegionOpen] = useState(false);
  useEffect(() => {
    // Only an admin sees (and may save) the region.
    if (!isAdmin) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/settings/watch-provider-regions');
        if (!res.ok) return;
        const data = await res.json();
        const list = Array.isArray(data?.regions) ? (data.regions as RegionOption[]) : null;
        if (!cancelled && list && list.length > 0) setRegions(list);
      } catch {
        // Leave as null; UI falls back to the static common-regions list below.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const regionOptions = useMemo<RegionOption[]>(() => {
    const base = regions ?? REGION_FALLBACK;
    const currentCode = settings?.watchProviderRegion;
    if (!currentCode || base.some((r) => r.code === currentCode)) return base;
    return [{ code: currentCode, name: currentCode }, ...base];
  }, [regions, settings?.watchProviderRegion]);

  const currentRegion = regionOptions.find((r) => r.code === (settings?.watchProviderRegion ?? 'US'));

  function pickRegion(code: string) {
    setRegionOpen(false);
    if (code === settings?.watchProviderRegion) return;
    void update(
      { watchProviderRegion: code },
      { successMessage: () => `Region set to ${code}` },
    );
  }

  // Debounced commit that flushes (instead of cancelling) on unmount, so a
  // quick back-nav can't silently drop the last edit.
  const tzCommit = useDebouncedCommit<string>((value) => {
    void update(
      { timeZone: value },
      {
        successMessage: (state) => `Server time zone set to ${state.timeZone}`,
      },
    ).then(() => setDraft(null));
  }, 600);

  function onTimeZoneChange(value: string) {
    setDraft(value);
    tzCommit.schedule(value);
  }

  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Settings
        </Link>
      </div>

      <div className="px-4 mb-4">
        <h1 className="text-2xl font-semibold">Preferences</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Changes save automatically.
        </p>
      </div>

      {/* The server's zone, polling, refresh and region are global settings
          that only an admin may save (PUT /api/settings); to a member they
          answered every pick with "Forbidden". "Your time zone" under Date &
          Time is personal. */}
      {isAdmin && (
        <GroupedSection title="General" footer="Synced across devices">
          <div className="px-4 py-3 border-b border-foreground/[0.06] space-y-1.5">
            <Label htmlFor="server-time-zone" className="text-xs text-muted-foreground">Server time zone</Label>
            <Input
              id="server-time-zone"
              placeholder={settings?.envTimeZone ?? 'UTC'}
              value={displayedTz}
              onChange={(event) => onTimeZoneChange(event.target.value)}
              onBlur={() => tzCommit.flush()}
              disabled={loading}
              className="h-10"
            />
            <div className="text-xs text-muted-foreground">
              Env default: {settings?.envTimeZone ?? 'UTC'}
            </div>
          </div>

          <div className="grouped-row">
            <span className="text-sm">Polling</span>
            <Select
              value={String(settings?.pollingIntervalSecs ?? 30)}
              onValueChange={(v) => void update({ pollingIntervalSecs: parseInt(v, 10) })}
              disabled={loading}
            >
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POLLING_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grouped-row">
            <span className="text-sm">Activity refresh</span>
            <Select
              value={String(settings?.activityRefreshIntervalSecs ?? 5)}
              onValueChange={(v) => void update({ activityRefreshIntervalSecs: parseInt(v, 10) })}
              disabled={loading}
            >
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFRESH_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grouped-row">
            <span className="text-sm">Torrents refresh</span>
            <Select
              value={String(settings?.torrentsRefreshIntervalSecs ?? 5)}
              onValueChange={(v) => void update({ torrentsRefreshIntervalSecs: parseInt(v, 10) })}
              disabled={loading}
            >
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFRESH_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </GroupedSection>
      )}

      <DateTimeFormatSection>
        <PersonalTimeZoneRow />
      </DateTimeFormatSection>

      {isAdmin && (
        <GroupedSection
          title="Where to Watch"
          footer="Used by Discover, Movies, and Series detail pages to show streaming availability"
        >
          {/* Searchable, current pick first: the same picker as Your time zone
              and Discover's region and language (c733), not a ~250-row list. */}
          <div className="grouped-row">
            <span className="text-sm shrink-0">Region</span>
            <ResponsiveCombobox
              open={regionOpen}
              onOpenChange={setRegionOpen}
              title="Where to Watch region"
              searchPlaceholder="Search regions"
              align="end"
              selectedValue={currentRegion ? `${currentRegion.name} ${currentRegion.code}` : undefined}
              trigger={
                <button
                  type="button"
                  aria-label="Region"
                  disabled={loading}
                  className="flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors dark:bg-input/30 dark:hover:bg-input/50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="truncate">{currentRegion ? `${currentRegion.name} · ${currentRegion.code}` : ''}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                </button>
              }
            >
              <CommandEmpty>No matches.</CommandEmpty>
              <CommandGroup>
                {(currentRegion
                  ? [currentRegion, ...regionOptions.filter((r) => r !== currentRegion)]
                  : regionOptions
                ).map((r) => (
                  <CommandItem key={r.code} value={`${r.name} ${r.code}`} onSelect={() => pickRegion(r.code)}>
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className="text-xs text-muted-foreground uppercase">{r.code}</span>
                    {r === currentRegion && <Check className="h-3.5 w-3.5 ml-1" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </ResponsiveCombobox>
          </div>
        </GroupedSection>
      )}

      {/* Its page needs settings.dashboardRefresh, which members lack by default. */}
      {hasCapability(me, 'settings.dashboardRefresh') && (
        <GroupedSection title="Widgets" footer="Synced across devices">
          <Link
            href="/settings/dashboard-refresh"
            className="grouped-row hover:bg-foreground/[0.03] active:bg-foreground/5 transition-colors"
          >
            <span className="text-sm">Dashboard widget refresh</span>
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              Configure
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        </GroupedSection>
      )}

      {hasCapability(me, 'jellyfin.view') && (
        <>
          <PlayerSection />
          <SubtitleAppearanceSection />
        </>
      )}
    </div>
  );
}
