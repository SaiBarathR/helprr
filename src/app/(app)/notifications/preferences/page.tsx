'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Bell, BellOff, Smartphone, ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePushNotifications } from '@/hooks/use-push-notifications';

const EVENT_SECTIONS: {
  title: string;
  events: Record<string, { label: string; description: string }>;
}[] = [
  {
    title: 'Sonarr / Radarr',
    events: {
      grabbed: { label: 'Download Grabbed', description: 'When Sonarr/Radarr grabs a download' },
      imported: { label: 'Media Imported', description: 'When a download is imported to library' },
      downloadFailed: { label: 'Download Failed', description: 'When a download fails' },
      importFailed: { label: 'Import Failed', description: 'When an import fails' },
      upcomingPremiere: { label: 'Upcoming Premiere', description: 'Upcoming episode or movie release' },
      healthWarning: { label: 'Health Warning', description: 'When a service has health issues' },
    },
  },
  {
    title: 'qBittorrent',
    events: {
      torrentAdded: { label: 'Torrent Added', description: 'When a new torrent is added' },
      torrentCompleted: { label: 'Download Complete', description: 'When a torrent finishes downloading' },
      torrentDeleted: { label: 'Torrent Removed', description: 'When a torrent is removed' },
    },
  },
  {
    title: 'Jellyfin',
    events: {
      jellyfinItemAdded: { label: 'Media Added', description: 'New media added to Jellyfin library' },
      jellyfinPlaybackStart: { label: 'Playback Started', description: 'Someone started streaming' },
    },
  },
];

interface Preference {
  id: string;
  subscriptionId: string;
  eventType: string;
  enabled: boolean;
}

export default function NotificationPreferencesPage() {
  const router = useRouter();
  const { isSupported, isSubscribed, isStandalone, subscribe, unsubscribe, loading, error: pushError, subscriptionEndpoint } = usePushNotifications();
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(false);

  useEffect(() => {
    if (isSubscribed && subscriptionEndpoint) {
      loadPreferences();
    }
  }, [isSubscribed, subscriptionEndpoint]);

  async function loadPreferences() {
    setPrefsLoading(true);
    try {
      const params = subscriptionEndpoint ? `?endpoint=${encodeURIComponent(subscriptionEndpoint)}` : '';
      const res = await fetch(`/api/notifications/preferences${params}`);
      if (res.ok) {
        const prefs = await res.json();
        setPreferences(prefs);
        if (prefs.length > 0) setSubscriptionId(prefs[0].subscriptionId);
      }
    } catch {} finally { setPrefsLoading(false); }
  }

  async function handleSubscribe() {
    const result = await subscribe();
    if (result.success) {
      toast.success('Push notifications enabled');
      loadPreferences();
    } else {
      toast.error(result.error || 'Could not enable push notifications');
    }
  }

  async function handleUnsubscribe() {
    await unsubscribe();
    toast.success('Push notifications disabled');
    setPreferences([]);
  }

  async function togglePreference(eventType: string, enabled: boolean) {
    if (!subscriptionId) return;
    setPreferences((prev) =>
      prev.map((p) => p.eventType === eventType ? { ...p, enabled } : p)
    );
    try {
      await fetch('/api/notifications/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId, eventType, enabled }),
      });
    } catch {
      toast.error('Failed to update preference');
      setPreferences((prev) =>
        prev.map((p) => p.eventType === eventType ? { ...p, enabled: !enabled } : p)
      );
    }
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.back()}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>
      <h1 className="text-2xl font-bold">Notification Preferences</h1>

      {!isSupported && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <BellOff className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Push notifications are not supported in this browser.</p>
          </CardContent>
        </Card>
      )}

      {isSupported && !isStandalone && (
        <Card className="border-orange-500/30">
          <CardContent className="py-6 text-center space-y-2">
            <Smartphone className="h-8 w-8 mx-auto text-orange-500" />
            <p className="font-medium">Install Helprr as a PWA for best experience</p>
            <p className="text-sm text-muted-foreground">
              On iOS: tap the share button in Safari, then &ldquo;Add to Home Screen&rdquo;.
              You can still enable notifications in the browser.
            </p>
          </CardContent>
        </Card>
      )}

      {pushError && (
        <Card className="border-red-500/30">
          <CardContent className="py-4 text-center text-sm text-red-400">
            {pushError}
          </CardContent>
        </Card>
      )}

      {isSupported && !isSubscribed && (
        <Card>
          <CardContent className="py-6 text-center space-y-3">
            <Bell className="h-8 w-8 mx-auto text-primary" />
            <p className="font-medium">Enable Push Notifications</p>
            <p className="text-sm text-muted-foreground">
              Get notified about downloads, imports, and upcoming releases.
            </p>
            <Button onClick={handleSubscribe} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bell className="mr-2 h-4 w-4" />}
              Enable Notifications
            </Button>
          </CardContent>
        </Card>
      )}

      {isSubscribed && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Event Types</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {prefsLoading ? (
              <p className="text-sm text-muted-foreground">Loading preferences...</p>
            ) : (
              EVENT_SECTIONS.map((section, i) => (
                <div key={section.title} className="space-y-3">
                  {i > 0 && <Separator />}
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{section.title}</p>
                  {Object.entries(section.events).map(([eventType, { label, description }]) => {
                    const pref = preferences.find((p) => p.eventType === eventType);
                    return (
                      <div key={eventType} className="flex items-center justify-between">
                        <div>
                          <Label className="text-sm font-medium">{label}</Label>
                          <p className="text-xs text-muted-foreground">{description}</p>
                        </div>
                        <Switch
                          checked={pref?.enabled ?? true}
                          onCheckedChange={(v) => togglePreference(eventType, v)}
                        />
                      </div>
                    );
                  })}
                </div>
              ))
            )}

            <Separator />
            <Button variant="destructive" size="sm" onClick={handleUnsubscribe} disabled={loading}>
              <BellOff className="mr-2 h-4 w-4" /> Disable Push Notifications
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
