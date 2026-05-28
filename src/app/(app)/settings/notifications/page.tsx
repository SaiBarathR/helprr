'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, BellOff, ChevronLeft, ChevronRight, Loader2, Send, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GroupedSection } from '@/components/settings/grouped-section';
import { useAppSettings } from '@/lib/hooks/use-app-settings';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { EventTypePrefs } from '@/components/notifications/event-type-prefs';

const TIMING_OPTIONS = [
  { value: 'before_air', label: 'Before air time' },
  { value: 'daily_digest', label: 'Daily digest' },
];

const DIGEST_MODE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

const DAY_OF_WEEK_OPTIONS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

const NOTIFY_BEFORE_OPTIONS = [
  { value: '0', label: 'At air time' },
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
  const {
    isSupported,
    isSubscribed,
    isStandalone,
    subscribe,
    unsubscribe,
    loading: pushLoading,
    error: pushError,
    subscriptionEndpoint,
    wasReregistered,
    dismissReregisteredNotice,
  } = usePushNotifications();
  const [testing, setTesting] = useState(false);

  const mode = settings?.upcomingNotifyMode ?? 'before_air';
  const digestMode = settings?.activityDigestMode ?? 'off';

  async function handleSubscribe() {
    const result = await subscribe();
    if (result.success) toast.success('Push notifications enabled');
    else toast.error(result.error || 'Could not enable push notifications');
  }

  async function handleUnsubscribe() {
    const result = await unsubscribe();
    if (result.success) toast.success('Push notifications disabled');
    else toast.error(result.error || 'Could not disable push notifications');
  }

  async function handleSendTest() {
    setTesting(true);
    try {
      const res = await fetch('/api/notifications/test', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { sent?: number };
      const count = data.sent ?? 0;
      if (count > 0) toast.success(`Test sent to ${count} device${count === 1 ? '' : 's'}`);
      else toast.error('No devices received the test — check the logs.');
    } catch (err) {
      console.error('send test failed', err);
      toast.error('Test notification failed');
    } finally {
      setTesting(false);
    }
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
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Push, event types, devices, and upcoming-release alerts.
        </p>
      </div>

      {!isSupported && (
        <GroupedSection>
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            <BellOff className="h-6 w-6 mx-auto mb-2 opacity-60" />
            Push notifications are not supported in this browser.
          </div>
        </GroupedSection>
      )}

      {isSupported && !isStandalone && (
        <GroupedSection>
          <div className="px-4 py-4 flex items-start gap-3">
            <Smartphone className="h-5 w-5 text-orange-400 mt-0.5 shrink-0" />
            <div className="text-sm space-y-1">
              <div className="font-medium">Install Helprr as a PWA for best results</div>
              <div className="text-xs text-muted-foreground">
                On iOS: tap the share button in Safari, then &ldquo;Add to Home Screen&rdquo;.
                You can still enable notifications in the browser.
              </div>
            </div>
          </div>
        </GroupedSection>
      )}

      {pushError && (
        <GroupedSection>
          <div className="px-4 py-3 text-sm text-red-400">{pushError}</div>
        </GroupedSection>
      )}

      {wasReregistered && (
        <GroupedSection>
          <div className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
            <span className="text-amber-300">
              Notifications were re-registered for this device.
            </span>
            <Button variant="ghost" size="sm" onClick={dismissReregisteredNotice}>
              Dismiss
            </Button>
          </div>
        </GroupedSection>
      )}

      {isSupported && (
        <GroupedSection title="This device" footer="Per-device — preferences below apply to this browser/PWA only">
          {!isSubscribed ? (
            <div className="px-4 py-4 space-y-3">
              <div className="flex items-start gap-3">
                <Bell className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div className="text-sm space-y-1">
                  <div className="font-medium">Push is off on this device</div>
                  <div className="text-xs text-muted-foreground">
                    Get notified about downloads, imports, and upcoming releases.
                  </div>
                </div>
              </div>
              <Button onClick={handleSubscribe} disabled={pushLoading} className="w-full h-9">
                {pushLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Bell className="mr-2 h-4 w-4" />
                )}
                Enable on this device
              </Button>
            </div>
          ) : (
            <div className="px-4 py-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSendTest}
                disabled={testing}
                className="flex-1 min-w-[140px] h-9"
              >
                {testing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Send test
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleUnsubscribe}
                disabled={pushLoading}
                className="flex-1 min-w-[140px] h-9 text-destructive hover:text-destructive"
              >
                <BellOff className="mr-2 h-4 w-4" />
                Disable on this device
              </Button>
            </div>
          )}
        </GroupedSection>
      )}

      <GroupedSection>
        <Link
          href="/settings/notifications/devices"
          className="grouped-row hover:bg-[oklch(1_0_0/3%)] active:bg-white/5 transition-colors"
        >
          <div className="text-sm font-medium">Devices</div>
          <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
            <span>Manage and revoke</span>
            <ChevronRight className="h-4 w-4" />
          </div>
        </Link>
      </GroupedSection>

      {isSupported && isSubscribed && subscriptionEndpoint && (
        <EventTypePrefs subscriptionEndpoint={subscriptionEndpoint} />
      )}

      <GroupedSection title="Upcoming releases" footer="Synced across devices">
        <div className="grouped-row">
          <span className="text-sm">Timing</span>
          <Select
            value={mode}
            onValueChange={(v) =>
              void update({ upcomingNotifyMode: v as 'before_air' | 'daily_digest' })
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

      <GroupedSection
        title="Activity digest"
        footer="A summary of imports, failures, and releases — sent once at the configured time."
      >
        <div className="grouped-row">
          <span className="text-sm">Frequency</span>
          <Select
            value={digestMode}
            onValueChange={(v) =>
              void update({ activityDigestMode: v as 'off' | 'daily' | 'weekly' })
            }
            disabled={loading}
          >
            <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIGEST_MODE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(digestMode === 'daily' || digestMode === 'weekly') && (
          <div className="grouped-row">
            <span className="text-sm">Send at</span>
            <Select
              value={String(settings?.activityDigestHour ?? 8)}
              onValueChange={(v) => void update({ activityDigestHour: parseInt(v, 10) })}
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

        {digestMode === 'weekly' && (
          <div className="grouped-row">
            <span className="text-sm">Day</span>
            <Select
              value={String(settings?.activityDigestDayOfWeek ?? 1)}
              onValueChange={(v) => void update({ activityDigestDayOfWeek: parseInt(v, 10) })}
              disabled={loading}
            >
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_OF_WEEK_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </GroupedSection>
    </div>
  );
}
