'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useMe } from '@/components/permission-provider';
import { SEERR_MEDIA_STATUS, type SeerrMediaStatus, type SeerrServiceData, type SeerrSeasonInfo } from '@/types/seerr';

// 'approve-pending' approves a Helprr-side pending request (creates it in Seerr).
export type RequestModalMode = 'create' | 'approve' | 'edit' | 'approve-pending';

interface SeerrRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: RequestModalMode;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  /** Required for approve/edit (Seerr request id). */
  requestId?: number;
  /** Required for 'approve-pending' (Helprr PendingRequest id). */
  pendingId?: string;
  /** Pre-fill (approve/edit) from the existing request. */
  initialSeasons?: number[];
  initialProfileId?: number | null;
  initialRootFolder?: string | null;
  initialTags?: number[];
  initialRequestedById?: number | null;
  onDone?: () => void;
}

interface SeerrUserOption {
  id: number;
  name: string;
}

function statusLabel(status: SeerrMediaStatus | null): string {
  switch (status) {
    case SEERR_MEDIA_STATUS.PENDING:
      return 'Pending';
    case SEERR_MEDIA_STATUS.PROCESSING:
      return 'Processing';
    case SEERR_MEDIA_STATUS.PARTIALLY_AVAILABLE:
      return 'Partially Available';
    case SEERR_MEDIA_STATUS.AVAILABLE:
      return 'Available';
    default:
      return 'Not Requested';
  }
}

const TITLES: Record<RequestModalMode, (mt: 'movie' | 'tv') => string> = {
  create: (mt) => (mt === 'movie' ? 'Request Movie' : 'Request Series'),
  approve: () => 'Pending Request',
  edit: () => 'Edit Request',
  'approve-pending': () => 'Pending Request',
};

export function SeerrRequestModal({
  open,
  onOpenChange,
  mode,
  mediaType,
  tmdbId,
  title,
  requestId,
  pendingId,
  initialSeasons,
  initialProfileId,
  initialRootFolder,
  initialTags,
  initialRequestedById,
  onDone,
}: SeerrRequestModalProps) {
  const me = useMe();
  const isAdmin = me?.role === 'admin';
  const isTv = mediaType === 'tv';
  const service = isTv ? 'sonarr' : 'radarr';

  // Form state.
  const [selectedSeasons, setSelectedSeasons] = useState<Set<number>>(new Set(initialSeasons ?? []));
  const [profileId, setProfileId] = useState<number | null>(initialProfileId ?? null);
  const [rootFolder, setRootFolder] = useState<string | null>(initialRootFolder ?? null);
  const [tags, setTags] = useState<number[]>(initialTags ?? []);
  const [requestAs, setRequestAs] = useState<number | null>(initialRequestedById ?? null);
  const [submitting, setSubmitting] = useState(false);

  const serviceQuery = useQuery({
    queryKey: ['seerr', 'service', service],
    queryFn: jsonFetcher<SeerrServiceData>(`/api/seerr/service/${service}`),
    enabled: open,
  });
  const seasonsQuery = useQuery({
    queryKey: ['seerr', 'tv', tmdbId],
    queryFn: jsonFetcher<{ seasons: SeerrSeasonInfo[] }>(`/api/seerr/tv/${tmdbId}`),
    enabled: open && isTv,
  });
  const usersQuery = useQuery({
    queryKey: ['seerr', 'users'],
    queryFn: jsonFetcher<{ results?: Array<{ id: number; displayName?: string; username?: string }> }>(
      '/api/seerr/users?take=100',
    ),
    enabled: open && isAdmin,
  });

  const serviceData = serviceQuery.data ?? null;
  const seasonsInfo = useMemo(() => seasonsQuery.data?.seasons ?? [], [seasonsQuery.data]);
  const users: SeerrUserOption[] = useMemo(
    () =>
      (usersQuery.data?.results ?? []).map((u) => ({
        id: u.id,
        name: u.displayName || u.username || `User ${u.id}`,
      })),
    [usersQuery.data],
  );

  const loading =
    serviceQuery.isLoading || (isTv && seasonsQuery.isLoading) || (isAdmin && usersQuery.isLoading);

  // Any of the option fetches failing matches the old single catch toast.
  useEffect(() => {
    if (serviceQuery.isError || seasonsQuery.isError || usersQuery.isError) {
      toast.error('Failed to load request options');
    }
  }, [serviceQuery.isError, seasonsQuery.isError, usersQuery.isError]);

  // Seed defaults that weren't pre-filled by an existing request, once the
  // service data resolves.
  useEffect(() => {
    if (!open) return;
    const svc = serviceQuery.data;
    if (!svc) return;
    if (initialProfileId == null && svc.defaultProfileId != null) setProfileId(svc.defaultProfileId);
    if (initialRootFolder == null && svc.defaultRootFolder != null) setRootFolder(svc.defaultRootFolder);
    if (!initialTags && svc.defaultTags) setTags(svc.defaultTags);
    if (requestAs == null) {
      const own = me?.seerrUserId ? Number.parseInt(me.seerrUserId, 10) : NaN;
      if (Number.isInteger(own)) setRequestAs(own);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, serviceQuery.data]);

  const selectableSeasons = useMemo(
    () => seasonsInfo.filter((s) => s.status !== SEERR_MEDIA_STATUS.AVAILABLE),
    [seasonsInfo]
  );
  const allSelected = selectableSeasons.length > 0 && selectableSeasons.every((s) => selectedSeasons.has(s.seasonNumber));

  function toggleSeason(n: number) {
    setSelectedSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }
  function toggleAll() {
    setSelectedSeasons((prev) => {
      if (selectableSeasons.every((s) => prev.has(s.seasonNumber))) return new Set();
      return new Set(selectableSeasons.map((s) => s.seasonNumber));
    });
  }

  function toggleTag(id: number) {
    setTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  const seasonsPayload = useMemo(
    () => [...selectedSeasons].sort((a, b) => a - b),
    [selectedSeasons]
  );

  const canSubmit =
    !submitting && !loading && (!isTv || mode !== 'create' || seasonsPayload.length > 0);

  async function submit() {
    setSubmitting(true);
    try {
      const overrides: Record<string, unknown> = {
        mediaType,
        ...(serviceData?.serverId != null ? { serverId: serviceData.serverId } : {}),
        ...(profileId != null ? { profileId } : {}),
        ...(rootFolder ? { rootFolder } : {}),
        tags,
        ...(isAdmin && requestAs != null ? { requestAs } : {}),
      };
      if (isTv) overrides.seasons = seasonsPayload;

      let res: Response;
      if (mode === 'create') {
        res = await fetch('/api/seerr/requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...overrides, tmdbId, title }),
        });
      } else if (mode === 'approve') {
        res = await fetch(`/api/seerr/requests/${requestId}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(overrides),
        });
      } else if (mode === 'approve-pending') {
        res = await fetch(`/api/seerr/pending-requests/${pendingId}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(overrides),
        });
      } else {
        res = await fetch(`/api/seerr/requests/${requestId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(overrides),
        });
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? 'Request failed');
        return;
      }
      // A member's create can be held for approval (gate) → distinct toast.
      if (mode === 'create') {
        const data = (await res.json().catch(() => ({}))) as { pending?: boolean };
        toast.success(data.pending ? 'Submitted for approval' : 'Requested');
      } else {
        toast.success(mode === 'edit' ? 'Saved' : 'Approved');
      }
      onOpenChange(false);
      onDone?.();
    } catch {
      toast.error('Request failed');
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel =
    mode === 'approve' || mode === 'approve-pending'
      ? 'Approve Request'
      : mode === 'edit'
        ? 'Save'
        : isTv
          ? seasonsPayload.length > 0
            ? `Request ${seasonsPayload.length} Season${seasonsPayload.length === 1 ? '' : 's'}`
            : 'Select Season(s)'
          : 'Request';

  const availableTagOptions = (serviceData?.tags ?? []).filter((t) => !tags.includes(t.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {TITLES[mode](mediaType)}
            <span className="block text-base font-normal text-muted-foreground">{title}</span>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto" />
          </div>
        ) : (
          <div className="space-y-5">
            {isTv && seasonsInfo.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <Switch checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all seasons" />
                  <span>SEASON</span>
                  <span># EPISODES</span>
                  <span className="text-right">STATUS</span>
                </div>
                {seasonsInfo.map((s) => {
                  const available = s.status === SEERR_MEDIA_STATUS.AVAILABLE;
                  return (
                    <div
                      key={s.seasonNumber}
                      className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 border-t border-border px-3 py-2.5 text-sm"
                    >
                      <Switch
                        checked={selectedSeasons.has(s.seasonNumber)}
                        onCheckedChange={() => toggleSeason(s.seasonNumber)}
                        disabled={available}
                        aria-label={`Season ${s.seasonNumber}`}
                      />
                      <span>Season {s.seasonNumber}</span>
                      <span className="text-muted-foreground">{s.episodeCount}</span>
                      <span className="text-right">
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                          {statusLabel(s.status)}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-4">
              <p className="text-sm font-semibold">Advanced</p>

              {(serviceData?.profiles.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  <Label>Quality Profile</Label>
                  <Select
                    value={profileId != null ? String(profileId) : undefined}
                    onValueChange={(v) => setProfileId(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Default" />
                    </SelectTrigger>
                    <SelectContent>
                      {serviceData?.profiles.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(serviceData?.rootFolders.length ?? 0) > 1 && (
                <div className="space-y-1.5">
                  <Label>Root Folder</Label>
                  <Select value={rootFolder ?? undefined} onValueChange={(v) => setRootFolder(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Default" />
                    </SelectTrigger>
                    <SelectContent>
                      {serviceData?.rootFolders.map((r) => (
                        <SelectItem key={r.id} value={r.path}>
                          {r.path}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(serviceData?.tags.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  <Label>Tags</Label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {tags.map((id) => {
                      const t = serviceData?.tags.find((x) => x.id === id);
                      if (!t) return null;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => toggleTag(id)}
                          className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary"
                        >
                          {t.label}
                          <X className="h-3 w-3" />
                        </button>
                      );
                    })}
                    {availableTagOptions.length > 0 && (
                      <Select value="" onValueChange={(v) => toggleTag(Number(v))}>
                        <SelectTrigger className="h-7 w-auto gap-1 px-2 text-xs">
                          <SelectValue placeholder="+ Add tag" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableTagOptions.map((t) => (
                            <SelectItem key={t.id} value={String(t.id)}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              )}

              {isAdmin && users.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Request As</Label>
                  <Select
                    value={requestAs != null ? String(requestAs) : undefined}
                    onValueChange={(v) => setRequestAs(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select user" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {mode === 'create' ? 'Cancel' : 'Close'}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
