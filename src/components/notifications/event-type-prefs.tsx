'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
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
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Last server-confirmed filter values per event, so a failed save reverts only
  // the edited field locally (no full reload, which would race in-progress edits).
  const savedFiltersRef = useRef<Map<string, { tagFilter: string | null; qualityFilter: string | null }>>(new Map());
  const me = useMe();

  const prefsQueryKey = ['notification-prefs', subscriptionEndpoint] as const;
  const { data: loadedPrefs, isLoading: loading } = useQuery({
    queryKey: prefsQueryKey,
    queryFn: jsonFetcher<Preference[]>(
      `/api/notifications/preferences?endpoint=${encodeURIComponent(subscriptionEndpoint)}`,
    ),
  });

  // Seed local editing state from the query — the toggles/filters are edited
  // optimistically in place, so the query is the load source and local state
  // holds the live, user-edited copy.
  useEffect(() => {
    if (!loadedPrefs) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed editable prefs from the query
    setPreferences(loadedPrefs);
    savedFiltersRef.current = new Map(
      loadedPrefs.map((p) => [p.eventType, { tagFilter: p.tagFilter, qualityFilter: p.qualityFilter }]),
    );
    // Reset (not retain) when empty, so a save can't be posted to a stale
    // subscription after the endpoint changes.
    setSubscriptionId(loadedPrefs.length > 0 ? loadedPrefs[0].subscriptionId : null);
  }, [loadedPrefs]);

  const savePreference = useMutation({
    mutationFn: async (body: {
      subscriptionId: string;
      eventType: string;
      enabled: boolean;
      tagFilter: string | null;
      qualityFilter: string | null;
    }) => {
      const res = await fetch('/api/notifications/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
  });

  function togglePreference(eventType: string, enabled: boolean) {
    if (!subscriptionId) return;
    const current = preferences.find((p) => p.eventType === eventType);
    setPreferences((prev) =>
      prev.map((p) => (p.eventType === eventType ? { ...p, enabled } : p)),
    );
    // Include the stored filters — the upsert nulls any field we omit, so
    // toggling enabled would otherwise wipe this event's tag/quality filter.
    savePreference.mutate(
      {
        subscriptionId,
        eventType,
        enabled,
        tagFilter: current?.tagFilter ?? null,
        qualityFilter: current?.qualityFilter ?? null,
      },
      {
        onSuccess: () => {
          savedFiltersRef.current.set(eventType, {
            tagFilter: current?.tagFilter ?? null,
            qualityFilter: current?.qualityFilter ?? null,
          });
          queryClient.invalidateQueries({ queryKey: prefsQueryKey });
        },
        onError: () => {
          toast.error('Failed to update preference');
          setPreferences((prev) =>
            prev.map((p) => (p.eventType === eventType ? { ...p, enabled: !enabled } : p)),
          );
        },
      },
    );
  }

  function setFilterValue(eventType: string, field: 'tagFilter' | 'qualityFilter', value: string) {
    setPreferences((prev) =>
      prev.map((p) => (p.eventType === eventType ? { ...p, [field]: value } : p)),
    );
  }

  function persistFilters(eventType: string) {
    if (!subscriptionId) return;
    const pref = preferences.find((p) => p.eventType === eventType);
    if (!pref) return;
    savePreference.mutate(
      {
        subscriptionId,
        eventType,
        enabled: pref.enabled,
        tagFilter: pref.tagFilter,
        qualityFilter: pref.qualityFilter,
      },
      {
        onSuccess: () => {
          savedFiltersRef.current.set(eventType, { tagFilter: pref.tagFilter, qualityFilter: pref.qualityFilter });
          queryClient.invalidateQueries({ queryKey: prefsQueryKey });
        },
        onError: () => {
          toast.error('Failed to save filter');
          // Revert only this event's filter fields to the last saved values — a full
          // reload would race any edit in flight on another field.
          const saved = savedFiltersRef.current.get(eventType) ?? { tagFilter: null, qualityFilter: null };
          setPreferences((prev) =>
            prev.map((p) =>
              p.eventType === eventType
                ? { ...p, tagFilter: saved.tagFilter, qualityFilter: saved.qualityFilter }
                : p,
            ),
          );
        },
      },
    );
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
