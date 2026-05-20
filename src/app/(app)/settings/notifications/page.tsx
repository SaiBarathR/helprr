'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GroupedSection } from '@/components/settings/grouped-section';
import { useAppSettings } from '@/lib/hooks/use-app-settings';

const ALERT_WINDOW_OPTIONS = [
  { value: '6', label: '6 hours' },
  { value: '12', label: '12 hours' },
  { value: '24', label: '24 hours' },
  { value: '48', label: '48 hours' },
  { value: '72', label: '72 hours' },
];

const TIMING_OPTIONS = [
  { value: 'before_air', label: 'Before air time' },
  { value: 'once_in_window', label: 'Once when entering window' },
  { value: 'daily_digest', label: 'Daily digest' },
];

const NOTIFY_BEFORE_OPTIONS = [
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
  { value: '360', label: '6 hours' },
  { value: '720', label: '12 hours' },
  { value: '1440', label: '24 hours' },
];

function hourLabel(h: number): string {
  if (h === 0) return '12:00 AM';
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return '12:00 PM';
  return `${h - 12}:00 PM`;
}

export default function NotificationsSettingsPage() {
  const { settings, loading, update } = useAppSettings();

  const mode = settings?.upcomingNotifyMode ?? 'before_air';

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
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Push alerts for upcoming releases. Changes save automatically.
        </p>
      </div>

      <GroupedSection title="Upcoming releases" footer="Synced across devices">
        <div className="grouped-row">
          <span className="text-sm">Alert window</span>
          <Select
            value={String(settings?.upcomingAlertHours ?? 24)}
            onValueChange={(v) => void update({ upcomingAlertHours: parseInt(v, 10) })}
            disabled={loading}
          >
            <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALERT_WINDOW_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grouped-row">
          <span className="text-sm">Timing</span>
          <Select
            value={mode}
            onValueChange={(v) =>
              void update({ upcomingNotifyMode: v as 'before_air' | 'once_in_window' | 'daily_digest' })
            }
            disabled={loading}
          >
            <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMING_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {mode === 'before_air' && (
          <div className="grouped-row">
            <span className="text-sm">Notify before</span>
            <Select
              value={String(settings?.upcomingNotifyBeforeMins ?? 60)}
              onValueChange={(v) => void update({ upcomingNotifyBeforeMins: parseInt(v, 10) })}
              disabled={loading}
            >
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTIFY_BEFORE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {mode === 'daily_digest' && (
          <div className="grouped-row">
            <span className="text-sm">Digest time</span>
            <Select
              value={String(settings?.upcomingDailyNotifyHour ?? 9)}
              onValueChange={(v) => void update({ upcomingDailyNotifyHour: parseInt(v, 10) })}
              disabled={loading}
            >
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {hourLabel(i)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </GroupedSection>
    </div>
  );
}
