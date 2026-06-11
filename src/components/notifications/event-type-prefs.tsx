'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { GroupedSection } from '@/components/settings/grouped-section';
import { EVENT_GROUPS, EVENT_META } from '@/lib/notification-events';
import { EVENT_TYPE_TO_CAPABILITY } from '@/lib/capabilities';
import { useMe, hasCapability } from '@/components/permission-provider';

// Per-item download/import events are the only ones that carry quality + tag
// metadata, so only they expose the filter inputs.
const FILTERABLE_EVENTS = new Set(['grabbed', 'imported', 'downloadFailed', 'importFailed']);

interface Preference {
  id: string;
  subscriptionId: string;
  eventType: string;
  enabled: boolean;
  tagFilter: string | null;
  qualityFilter: string | null;
}

interface EventTypePrefsProps {
  subscriptionEndpoint: string;
}

export function EventTypePrefs({ subscriptionEndpoint }: EventTypePrefsProps) {
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const me = useMe();

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

  function setFilterValue(eventType: string, field: 'tagFilter' | 'qualityFilter', value: string) {
    setPreferences((prev) =>
      prev.map((p) => (p.eventType === eventType ? { ...p, [field]: value } : p)),
    );
  }

  async function persistFilters(eventType: string) {
    if (!subscriptionId) return;
    const pref = preferences.find((p) => p.eventType === eventType);
    if (!pref) return;
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptionId,
          eventType,
          enabled: pref.enabled,
          tagFilter: pref.tagFilter,
          qualityFilter: pref.qualityFilter,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      toast.error('Failed to save filter');
    }
  }

  function toggleExpanded(eventType: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(eventType)) next.delete(eventType);
      else next.add(eventType);
      return next;
    });
  }

  return (
    <>
      {EVENT_GROUPS.map((group) => {
        // Only show toggles for events the user is actually eligible to receive
        // (a Member never sees Cleanup/Health). Hide a group that's fully gated.
        const visibleTypes = group.types.filter((t) =>
          hasCapability(me, EVENT_TYPE_TO_CAPABILITY[t])
        );
        if (visibleTypes.length === 0) return null;
        return (
        <GroupedSection key={group.id} title={group.title}>
          {visibleTypes.map((eventType) => {
            const meta = EVENT_META[eventType];
            const pref = preferences.find((p) => p.eventType === eventType);
            const checked = pref?.enabled ?? true;
            const canFilter = FILTERABLE_EVENTS.has(eventType);
            const isExpanded = expanded.has(eventType);
            const hasFilter = Boolean(pref?.qualityFilter || pref?.tagFilter);
            return (
              <Fragment key={eventType}>
                <div className="grouped-row items-start">
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="text-sm font-medium">{meta.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {meta.description}
                    </div>
                    {canFilter && checked && (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(eventType)}
                        className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary min-h-[24px]"
                      >
                        <SlidersHorizontal className="h-3 w-3" />
                        {isExpanded ? 'Hide filters' : hasFilter ? 'Filters · on' : 'Add filters'}
                      </button>
                    )}
                  </div>
                  <Switch
                    checked={checked}
                    onCheckedChange={(v) => void togglePreference(eventType, v)}
                    disabled={loading || !subscriptionId}
                    aria-label={meta.label}
                  />
                </div>
                {canFilter && checked && isExpanded && (
                  <div className="px-4 pb-3 pt-1 space-y-2">
                    <div>
                      <label className="text-xs text-muted-foreground">Only these qualities</label>
                      <Input
                        value={pref?.qualityFilter ?? ''}
                        onChange={(e) => setFilterValue(eventType, 'qualityFilter', e.target.value)}
                        onBlur={() => void persistFilters(eventType)}
                        placeholder="e.g. 2160p, 1080p"
                        className="mt-1 h-8 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Only these tags</label>
                      <Input
                        value={pref?.tagFilter ?? ''}
                        onChange={(e) => setFilterValue(eventType, 'tagFilter', e.target.value)}
                        onBlur={() => void persistFilters(eventType)}
                        placeholder="e.g. kids, anime"
                        className="mt-1 h-8 text-sm"
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Comma-separated, case-insensitive. Leave blank to receive all. When set, this device is
                      only notified for matching items.
                    </p>
                  </div>
                )}
              </Fragment>
            );
          })}
        </GroupedSection>
        );
      })}
    </>
  );
}
