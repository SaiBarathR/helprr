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
import type { ScheduledAlertDraft, ReleaseKind } from '@/lib/scheduled-alerts/types';
import { RELEASE_KIND_LABELS, defaultScopeForDraft } from '@/lib/scheduled-alerts/constants';
import { cn } from '@/lib/utils';
import { useCan } from '@/components/permission-provider';

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

  const releaseOptions =
    draft?.mediaType === 'movie'
      ? MOVIE_RELEASE_OPTIONS
      : draft?.mediaType === 'anime'
        ? ANIME_RELEASE_OPTIONS
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
      .then((data: { defaults?: PreviewDefaults; candidates?: unknown[] } | null) => {
        if (controller.signal.aborted || !data?.defaults) return;
        setScheduleMode(data.defaults.scheduleMode);
        setReleaseTypes(data.defaults.releaseTypes);
        setOffsetMinutes(data.defaults.offsetMinutes);
        setAbsoluteValue(toDatetimeLocalValue(data.defaults.absoluteNotifyAt));
        setPreviewCount(data.candidates?.length ?? 0);
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
      toast.success('Alert scheduled');
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
      scope: defaultScopeForDraft(draft),
      releaseTypes,
      offsetMinutes,
      absoluteNotifyAt,
      title,
    };
    if (!alertId) body.draft = { ...draft, title };
    saveMutation.mutate(body);
  }

  const saving = saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule alert</DialogTitle>
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
              <div className="grid grid-cols-2 gap-1 p-1 rounded-md bg-muted/40">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setScheduleMode('release_relative')}
                  className={cn(
                    'py-2 rounded text-xs font-medium transition-colors',
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
            </div>

            {scheduleMode === 'absolute' ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="sa-datetime">Remind me at</Label>
                <Input
                  id="sa-datetime"
                  type="datetime-local"
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
              </>
            )}

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1 text-xs text-primary"
            >
              {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              More options
            </button>

            {showAdvanced && scheduleMode === 'release_relative' && (
              <div className="flex flex-col gap-3 rounded-md border border-border/60 bg-muted/20 p-3">
                <div className="flex flex-col gap-2">
                  <Label>Release types</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {releaseOptions.map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        disabled={saving}
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
  onSaved?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ScheduledAlertButton({
  draft,
  variant = 'icon',
  className,
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
