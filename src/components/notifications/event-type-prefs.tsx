'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { GroupedSection } from '@/components/settings/grouped-section';
import { EVENT_GROUPS, EVENT_META } from '@/lib/notification-events';

interface Preference {
  id: string;
  subscriptionId: string;
  eventType: string;
  enabled: boolean;
}

interface EventTypePrefsProps {
  subscriptionEndpoint: string;
}

export function EventTypePrefs({ subscriptionEndpoint }: EventTypePrefsProps) {
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/notifications/preferences?endpoint=${encodeURIComponent(subscriptionEndpoint)}`,
      );
      if (!res.ok) return;
      const prefs = (await res.json()) as Preference[];
      setPreferences(prefs);
      if (prefs.length > 0) setSubscriptionId(prefs[0].subscriptionId);
    } catch (err) {
      console.error('loadPreferences failed:', err);
    } finally {
      setLoading(false);
    }
  }, [subscriptionEndpoint]);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  async function togglePreference(eventType: string, enabled: boolean) {
    if (!subscriptionId) return;
    setPreferences((prev) =>
      prev.map((p) => (p.eventType === eventType ? { ...p, enabled } : p)),
    );
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId, eventType, enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      toast.error('Failed to update preference');
      setPreferences((prev) =>
        prev.map((p) => (p.eventType === eventType ? { ...p, enabled: !enabled } : p)),
      );
    }
  }

  return (
    <>
      {EVENT_GROUPS.map((group) => (
        <GroupedSection key={group.id} title={group.title}>
          {group.types.map((eventType) => {
            const meta = EVENT_META[eventType];
            const pref = preferences.find((p) => p.eventType === eventType);
            const checked = pref?.enabled ?? true;
            return (
              <div key={eventType} className="grouped-row items-start">
                <div className="min-w-0 flex-1 pr-3">
                  <div className="text-sm font-medium">{meta.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {meta.description}
                  </div>
                </div>
                <Switch
                  checked={checked}
                  onCheckedChange={(v) => void togglePreference(eventType, v)}
                  disabled={loading || !subscriptionId}
                  aria-label={meta.label}
                />
              </div>
            );
          })}
        </GroupedSection>
      ))}
    </>
  );
}
