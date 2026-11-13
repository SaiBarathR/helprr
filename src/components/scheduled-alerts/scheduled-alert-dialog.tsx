'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Bell, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/query-fetch';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScheduledAlertSummary } from '@/components/scheduled-alerts/scheduled-alert-summary';
import type { ScheduledAlertDraft, ReleaseKind, ReleasedKind } from '@/lib/scheduled-alerts/types';
import { DEFAULT_HORIZON_DAYS, RELEASE_KIND_LABELS, defaultScopeForDraft, releasedNote } from '@/lib/scheduled-alerts/constants';
import { cn } from '@/lib/utils';
import { useCan } from '@/components/permission-provider';
import { skipAutoFocusOnTouch } from '@/lib/touch-autofocus';

export type { ScheduledAlertDraft };

interface PreviewDefaults {
  scheduleMode: 'absolute' | 'release_relative';
  scope: string;
  releaseTypes: ReleaseKind[];
  offsetMinutes: number;
  absoluteNotifyAt: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: ScheduledAlertDraft | null;
  onSaved?: () => void;
  alertId?: string;
  initialScheduleMode?: 'absolute' | 'release_relative';
  initialReleaseTypes?: ReleaseKind[];
  initialOffsetMinutes?: number;
  initialAbsoluteNotifyAt?: string | null;
  allowTitleEdit?: boolean;
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MOVIE_RELEASE_OPTIONS: ReleaseKind[] = ['digital', 'cinema', 'physical'];
const SERIES_RELEASE_OPTIONS: ReleaseKind[] = ['episode'];
const ANIME_RELEASE_OPTIONS: ReleaseKind[] = ['airing'];
const MUSIC_RELEASE_OPTIONS: ReleaseKind[] = ['album'];

export function ScheduledAlertDialog({
  open,
  onOpenChange,
  draft,
  onSaved,
  alertId,
  initialScheduleMode,
  initialReleaseTypes,
  initialOffsetMinutes,
  initialAbsoluteNotifyAt,
  allowTitleEdit = false,
}: Props) {
  const [scheduleMode, setScheduleMode] = useState<'absolute' | 'release_relative'>('release_relative');
  const [releaseTypes, setReleaseTypes] = useState<ReleaseKind[]>(['episode']);
  const [offsetMinutes, setOffsetMinutes] = useState(60);
  const [absoluteValue, setAbsoluteValue] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [previewCount, setPreviewCount] = useState(0);
  const [titleValue, setTitleValue] = useState('');

  // The server's word (from the preview) that the album, film or episode is
  // already out: a release reminder on it would never go off.
  const [released, setReleased] = useState<ReleasedKind | null>(null);
  // The release types the preview's count is for: a hint about it only holds
  // while they are still the ones picked. A release due sooner than the notice
  // has no candidate either, which the save explains.
  const [previewTypes, setPreviewTypes] = useState<ReleaseKind[] | null>(null);
  const [tooSoon, setTooSoon] = useState(false);
  const releaseOptions =
    draft?.mediaType === 'movie'
      ? MOVIE_RELEASE_OPTIONS
      : draft?.mediaType === 'anime'
        ? ANIME_RELEASE_OPTIONS
        : draft?.mediaType === 'music'
          ? MUSIC_RELEASE_OPTIONS
          : SERIES_RELEASE_OPTIONS;

  // Seed the form whenever the dialog opens (or its inputs change while open).
  // Guarded during render; the preview fetch below fills defaults when no
  // initial values were passed.
  const [prev, setPrev] = useState<{
    open: boolean;
    draft: typeof draft;
    initialScheduleMode: typeof initialScheduleMode;
    initialReleaseTypes: typeof initialReleaseTypes;
    initialOffsetMinutes: typeof initialOffsetMinutes;
    initialAbsoluteNotifyAt: typeof initialAbsoluteNotifyAt;
  } | null>(null);
  if (
    !prev ||
    prev.open !== open ||
    prev.draft !== draft ||
    prev.initialScheduleMode !== initialScheduleMode ||
    prev.initialReleaseTypes !== initialReleaseTypes ||
    prev.initialOffsetMinutes !== initialOffsetMinutes ||
    prev.initialAbsoluteNotifyAt !== initialAbsoluteNotifyAt
  ) {
    setPrev({ open, draft, initialScheduleMode, initialReleaseTypes, initialOffsetMinutes, initialAbsoluteNotifyAt });
    if (open && draft) {
      setTitleValue(draft.title);
      setPreviewCount(0);
      setReleased(null);
      setPreviewTypes(null);
      setTooSoon(false);
      if (initialScheduleMode) {
        setScheduleMode(initialScheduleMode);
        setReleaseTypes(initialReleaseTypes ?? []);
        setOffsetMinutes(initialOffsetMinutes ?? 60);
        setAbsoluteValue(toDatetimeLocalValue(initialAbsoluteNotifyAt));
      }
    }
  }

  useEffect(() => {
    if (!open || !draft || initialScheduleMode) return;

    const controller = new AbortController();
    void fetch('/api/scheduled-alerts/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft }),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { defaults?: PreviewDefaults; candidates?: unknown[]; released?: ReleasedKind; tooSoon?: true } | null) => {
        if (controller.signal.aborted || !data?.defaults) return;
        setScheduleMode(data.defaults.scheduleMode);
        setReleaseTypes(data.defaults.releaseTypes);
        setOffsetMinutes(data.defaults.offsetMinutes);
        setAbsoluteValue(toDatetimeLocalValue(data.defaults.absoluteNotifyAt));
        setPreviewCount(data.candidates?.length ?? 0);
        setReleased(data.released ?? null);
        setPreviewTypes(data.defaults.releaseTypes);
        setTooSoon(data.tooSoon === true);
      })
      .catch(() => {});

    return () => controller.abort();
  }, [open, draft, initialScheduleMode]);

  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(alertId ? `/api/scheduled-alerts/${alertId}` : '/api/scheduled-alerts', {
        method: alertId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new ApiError(res.status, err?.error ?? 'Failed to save alert');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(alertId ? 'Alert updated' : 'Alert scheduled');
      onOpenChange(false);
      onSaved?.();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Failed to save alert');
    },
  });

  const toggleReleaseType = useCallback((kind: ReleaseKind) => {
    setReleaseTypes((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  }, []);

  function handleSave() {
    if (!draft) return;
    const title = allowTitleEdit ? titleValue.trim() : draft.title;
    if (!title) {
      toast.error('Enter an alert title');
      return;
    }
    let absoluteNotifyAt: string | undefined;
    if (scheduleMode === 'absolute') {
      if (!absoluteValue) {
        toast.error('Pick a reminder date');
        return;
      }
      const d = new Date(absoluteValue);
      if (!Number.isFinite(d.getTime()) || d.getTime() < Date.now() - 60_000) {
        toast.error('Reminder must be in the future');
        return;
      }
      absoluteNotifyAt = d.toISOString();
    }
    const body: Record<string, unknown> = {
      scheduleMode,
      releaseTypes,
      offsetMinutes,
      absoluteNotifyAt,
      title,
    };
    // An edit keeps the alert's scope: the draft rebuilt from a saved alert no
    // longer carries the season, episode or album that chose it.
    if (!alertId) {
      body.scope = defaultScopeForDraft(draft);
      body.draft = { ...draft, title };
    }
    saveMutation.mutate(body);
  }

  const saving = saveMutation.isPending;
  // Saved now, a film's reminder would wait for a date: say so rather than
  // look scheduled. Films only: Radarr's and TMDB's film dates are complete,
  // while Sonarr's calendar leaves out unmonitored episodes that have a date.
  const noDateYet =
    previewTypes != null && previewCount === 0 && !released && !tooSoon && draft?.mediaType === 'movie'
    && previewTypes.length === releaseTypes.length && previewTypes.every((k) => releaseTypes.includes(k));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* On a phone the focused title would open the keyboard over the date and Save. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto" onOpenAutoFocus={skipAutoFocusOnTouch}>
        <DialogHeader>
          <DialogTitle>{alertId ? 'Edit alert' : 'Schedule alert'}</DialogTitle>
        </DialogHeader>
        {draft && (
          <div className="flex flex-col gap-4">
            {allowTitleEdit ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="sa-title">Alert title</Label>
                <Input
                  id="sa-title"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  disabled={saving}
                  placeholder="What should this remind you about?"
                />
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium truncate">{draft.title}</p>
                {draft.subtitle && (
                  <p className="text-xs text-muted-foreground truncate">{draft.subtitle}</p>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label>Alert type</Label>
              <div role="group" aria-label="Alert type" className="grid grid-cols-2 gap-1 p-1 rounded-md bg-muted/40">
                <button
                  type="button"
                  disabled={saving || released != null}
                  aria-pressed={scheduleMode === 'release_relative'}
                  onClick={() => setScheduleMode('release_relative')}
                  className={cn(
                    'py-2 rounded text-xs font-medium transition-colors disabled:opacity-50',
                    scheduleMode === 'release_relative'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground',
                  )}
                >
                  Release reminder
                </button>
                <button
                  type="button"
                  disabled={saving}
                  aria-pressed={scheduleMode === 'absolute'}
                  onClick={() => setScheduleMode('absolute')}
                  className={cn(
                    'py-2 rounded text-xs font-medium transition-colors',
                    scheduleMode === 'absolute'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground',
                  )}
                >
                  Custom date
                </button>
              </div>
              {released && (
                <p className="text-[11px] text-muted-foreground">
                  {releasedNote(released)}
                </p>
              )}
            </div>

            {scheduleMode === 'absolute' ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="sa-datetime">Remind me at</Label>
                <Input
                  id="sa-datetime"
                  type="datetime-local"
                  // iOS gives a native date field its own width, past the
                  // dialog's padding; without its native look it fills the row.
                  className="appearance-none [&::-webkit-date-and-time-value]:text-left"
                  value={absoluteValue}
                  onChange={(e) => setAbsoluteValue(e.target.value)}
                  disabled={saving}
                />
              </div>
            ) : (
              <>
                <ScheduledAlertSummary
                  scheduleMode={scheduleMode}
                  releaseTypes={releaseTypes}
                  offsetMinutes={offsetMinutes}
                />
                {previewCount > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {previewCount} upcoming release{previewCount === 1 ? '' : 's'} found
                  </p>
                )}
                {noDateYet && (
                  <p className="text-[11px] text-muted-foreground">
                    No {releaseTypes.map((k) => RELEASE_KIND_LABELS[k]).join(' or ')} date in the next {DEFAULT_HORIZON_DAYS} days yet.
                    The alert stays on and reminds you when one comes up. Other releases are under More options.
                  </p>
                )}
                {draft.mediaType === 'music' && draft.albumId == null && (
                  <p className="text-[11px] text-muted-foreground">
                    You also get a push as soon as Lidarr adds an album ahead.
                  </p>
                )}
              </>
            )}

            <button
              type="button"
              // The panel shows only for release reminders.
              aria-expanded={showAdvanced && scheduleMode === 'release_relative'}
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1 text-xs text-primary"
            >
              {showAdvanced && scheduleMode === 'release_relative' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              More options
            </button>

            {showAdvanced && scheduleMode === 'release_relative' && (
              <div className="flex flex-col gap-3 rounded-md border border-border/60 bg-muted/20 p-3">
                <div className="flex flex-col gap-2">
                  <Label>Release types</Label>
                  <div role="group" aria-label="Release types" className="flex flex-wrap gap-1.5">
                    {releaseOptions.map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        disabled={saving}
                        aria-pressed={releaseTypes.includes(kind)}
                        onClick={() => toggleReleaseType(kind)}
                        className={cn(
                          'px-2.5 py-1 rounded-full text-xs border transition-colors',
                          releaseTypes.includes(kind)
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted/40 border-transparent',
                        )}
                      >
                        {RELEASE_KIND_LABELS[kind]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sa-offset">Notify before (minutes)</Label>
                  <Input
                    id="sa-offset"
                    type="number"
                    min={0}
                    max={10080}
                    value={offsetMinutes}
                    onChange={(e) => setOffsetMinutes(Number(e.target.value) || 0)}
                    disabled={saving}
                  />
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !draft}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {alertId ? 'Save changes' : 'Save alert'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ButtonProps {
  draft: ScheduledAlertDraft;
  variant?: 'icon' | 'button';
  className?: string;
  /**
   * The icon's 44px hit area: `full` (default) grows it both ways; `height`
   * grows only its height, for spots where a wider area would reach a
   * neighbour (the poster pair on a mouse).
   */
  hitArea?: 'full' | 'height';
  onSaved?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ScheduledAlertButton({
  draft,
  variant = 'icon',
  className,
  hitArea = 'full',
  onSaved,
  open: controlledOpen,
  onOpenChange,
}: ButtonProps) {
  const canEdit = useCan('scheduledAlerts.edit');
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  if (!canEdit) return null;

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          aria-label="Schedule alert"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          className={cn(
            'flex items-center justify-center rounded-full bg-background/55 backdrop-blur-md text-foreground hover:bg-background/80 transition-colors',
            'h-9 w-9',
            className,
            // After the watchlist button the shared touch-target rule grows
            // this area rightward, so it never covers that button.
            'relative',
            hitArea === 'height' ? 'touch-target-y' : 'touch-target',
          )}
        >
          <Bell className="h-3.5 w-3.5" />
        </button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={className}
          onClick={() => setOpen(true)}
        >
          <Bell data-icon="inline-start" />
          Schedule alert
        </Button>
      )}
      <ScheduledAlertDialog open={open} onOpenChange={setOpen} draft={draft} onSaved={onSaved} />
    </>
  );
}
