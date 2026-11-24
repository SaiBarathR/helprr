'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronRight, Loader2 } from 'lucide-react';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import {
  MAX_ACTIVE_LIMIT,
  SHARE_LIMIT_ACTIONS,
  type QueueSeedingPatch,
  type QueueSeedingPreferences,
  type ShareLimitAction,
} from '@/lib/qbittorrent-queue-seeding';
import { ShareLimitsSection, type ShareLimitValues } from './share-limits-section';

const PREFS_URL = '/api/qbittorrent/queue-seeding';
const KEY = ['qbittorrent', 'queue-seeding'] as const;
// The queue buttons of the torrent pages read whether queueing is on from here.
const OPTIONS_KEY = ['qbittorrent', 'options'] as const;
const REMOVE_WITH_FILES: ShareLimitAction = 3;

type CountKey = 'max_active_downloads' | 'max_active_uploads' | 'max_active_torrents';
const COUNTS: { key: CountKey; label: string }[] = [
  { key: 'max_active_downloads', label: 'Max Active Downloads' },
  { key: 'max_active_uploads', label: 'Max Active Uploads' },
  { key: 'max_active_torrents', label: 'Max Active Torrents' },
];

async function patchPreferences(patch: QueueSeedingPatch): Promise<void> {
  const res = await fetch(PREFS_URL, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    // ApiError so a 401 reaches the global MutationCache handler (redirect).
    throw new ApiError(res.status, data?.error || 'Failed to update qBittorrent settings');
  }
}

function formatCount(value: number): string {
  return value < 0 ? 'No limit' : String(value);
}

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grouped-row">
      <span className="text-sm">{label}</span>
      <span className="text-sm text-muted-foreground text-right min-w-0 ml-4">{value}</span>
    </div>
  );
}

/** A count row; tapping it opens an inline editor, as the speed limits do. */
function CountInput({ label, value, onSave }: { label: string; value: number; onSave: (value: number) => Promise<boolean> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (next: number) => {
    setSaving(true);
    try {
      if (await onSave(next)) setDraft(null);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    // A form, so the keyboard's return key saves too.
    event.preventDefault();
    const number = Number(draft);
    if (draft === null || draft.trim() === '' || !Number.isInteger(number) || number < 0 || number > MAX_ACTIVE_LIMIT) {
      toast.error(`Enter a whole number from 0 to ${MAX_ACTIVE_LIMIT.toLocaleString()}`);
      return;
    }
    void save(number);
  };

  if (draft === null) {
    return (
      <button
        type="button"
        className="grouped-row w-full text-left hover:bg-foreground/[0.03] active:bg-foreground/5 transition-colors"
        onClick={() => setDraft(value < 0 ? '' : String(value))}
      >
        <span className="text-sm">{label}</span>
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          {formatCount(value)}
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </button>
    );
  }

  return (
    <form className="grouped-row grouped-row-stacked gap-3" onSubmit={handleSubmit}>
      <span className="text-sm">{label}</span>
      <Input
        type="number"
        inputMode="numeric"
        min="0"
        step="1"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="0"
        aria-label={label}
        autoFocus
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="flex-1" disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="outline" className="flex-1" onClick={() => void save(-1)} disabled={saving}>
          No limit
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Torrents settings → Queueing and Seeding Limits (QBT-25): qBittorrent's own
 * preferences, so they apply to every torrent. Everyone with torrents.view
 * sees them; only admins change them (the route enforces it).
 */
export function QueueSeedingSections({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: jsonFetcher<QueueSeedingPreferences>(PREFS_URL),
    // qBittorrent's own Web UI can change them; read fresh on each visit.
    staleTime: 0,
  });
  const prefs = query.data;
  const [confirmAction, setConfirmAction] = useState(false);

  const { mutateAsync, isPending } = useMutation({
    mutationFn: patchPreferences,
    onSuccess: (_data, patch) => {
      queryClient.setQueryData<QueueSeedingPreferences>(KEY, (old) => (old ? { ...old, ...patch } : old));
      if (patch.queueing_enabled !== undefined) void queryClient.invalidateQueries({ queryKey: OPTIONS_KEY });
    },
  });

  /** Resolves false once the failure has been toasted. */
  const save = async (patch: QueueSeedingPatch, success?: string): Promise<boolean> => {
    try {
      await mutateAsync(patch);
      if (success) toast.success(success);
      return true;
    } catch (error) {
      // 401 is handled globally (redirect to /login).
      if (!(error instanceof ApiError && error.status === 401)) {
        toast.error(error instanceof Error ? error.message : 'Failed to update qBittorrent settings');
      }
      return false;
    }
  };

  if (query.isLoading) {
    return (
      <GroupedSection title="Queueing">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </GroupedSection>
    );
  }
  if (!prefs) {
    return (
      <GroupedSection title="Queueing">
        <ErrorState
          compact
          message="Failed to load queueing and seeding settings."
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </GroupedSection>
    );
  }

  const seedingValues: ShareLimitValues = {
    ratio_limit: prefs.max_ratio_enabled ? prefs.max_ratio : -1,
    seeding_time_limit: prefs.max_seeding_time_enabled ? prefs.max_seeding_time : -1,
    inactive_seeding_time_limit: prefs.max_inactive_seeding_time_enabled ? prefs.max_inactive_seeding_time : -1,
  };
  // A limit's value goes only with its switch on (parseQueueSeedingPatch).
  const saveSeeding = (values: ShareLimitValues) => save({
    max_ratio_enabled: values.ratio_limit >= 0,
    ...(values.ratio_limit >= 0 && { max_ratio: values.ratio_limit }),
    max_seeding_time_enabled: values.seeding_time_limit >= 0,
    ...(values.seeding_time_limit >= 0 && { max_seeding_time: values.seeding_time_limit }),
    max_inactive_seeding_time_enabled: values.inactive_seeding_time_limit >= 0,
    ...(values.inactive_seeding_time_limit >= 0 && { max_inactive_seeding_time: values.inactive_seeding_time_limit }),
  });
  const actionLabel = SHARE_LIMIT_ACTIONS.find((a) => a.value === prefs.max_ratio_act)?.label ?? 'Unknown';
  const setAction = (value: ShareLimitAction) => {
    if (value === REMOVE_WITH_FILES) setConfirmAction(true);
    else void save({ max_ratio_act: value }, 'Limit action updated');
  };

  return (
    <>
      <GroupedSection
        title="Queueing"
        footer="For every torrent in qBittorrent. While queueing is off, every torrent runs at once and the queue buttons are off."
      >
        {isAdmin ? (
          <div className="grouped-row">
            <span className="text-sm">Torrent Queueing</span>
            <Switch
              checked={prefs.queueing_enabled}
              onCheckedChange={(on) => void save({ queueing_enabled: on }, on ? 'Queueing turned on' : 'Queueing turned off')}
              aria-label="Torrent Queueing"
            />
          </div>
        ) : (
          <ValueRow label="Torrent Queueing" value={prefs.queueing_enabled ? 'On' : 'Off'} />
        )}
        {prefs.queueing_enabled && (
          <>
            {COUNTS.map(({ key, label }) => (isAdmin ? (
              <CountInput key={key} label={label} value={prefs[key]} onSave={(value) => save({ [key]: value }, `${label} updated`)} />
            ) : (
              <ValueRow key={key} label={label} value={formatCount(prefs[key])} />
            )))}
            {isAdmin ? (
              <div className="grouped-row items-start">
                <div className="min-w-0 flex-1 pr-3">
                  <div className="text-sm">Don&apos;t Count Slow Torrents</div>
                  <div className="text-xs text-muted-foreground mt-0.5">A slow torrent doesn&apos;t take one of the active places.</div>
                </div>
                <Switch
                  checked={prefs.dont_count_slow_torrents}
                  onCheckedChange={(on) => void save({ dont_count_slow_torrents: on })}
                  aria-label="Don't Count Slow Torrents"
                />
              </div>
            ) : (
              <ValueRow label="Don't Count Slow Torrents" value={prefs.dont_count_slow_torrents ? 'On' : 'Off'} />
            )}
          </>
        )}
      </GroupedSection>

      <ShareLimitsSection
        title="Seeding Limits"
        footer="For every torrent that uses the global limits. A torrent can set its own in its settings."
        allowGlobal={false}
        values={seedingValues}
        readOnly={!isAdmin}
        onSave={saveSeeding}
      />

      <GroupedSection
        title="When a Seeding Limit Is Reached"
        footer={prefs.max_ratio_act === REMOVE_WITH_FILES ? 'qBittorrent deletes the downloaded files too.' : undefined}
      >
        {isAdmin ? (
          <div className="grouped-row">
            <span className="text-sm">Then</span>
            <Select value={String(prefs.max_ratio_act)} onValueChange={(v) => setAction(Number(v) as ShareLimitAction)}>
              <SelectTrigger aria-label="When a seeding limit is reached" className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHARE_LIMIT_ACTIONS.map((action) => (
                  <SelectItem key={action.value} value={String(action.value)}>{action.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <ValueRow label="Then" value={actionLabel} />
        )}
      </GroupedSection>

      <ConfirmDialog
        open={confirmAction}
        onOpenChange={setConfirmAction}
        title="Remove torrents and their files?"
        description="Every torrent that reaches a seeding limit will be removed from qBittorrent with its downloaded files, including torrents already past a limit."
        confirmLabel="Remove with files"
        destructive
        busy={isPending}
        onConfirm={async () => {
          if (await save({ max_ratio_act: REMOVE_WITH_FILES }, 'Limit action updated')) setConfirmAction(false);
        }}
      />
    </>
  );
}
