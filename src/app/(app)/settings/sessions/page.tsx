'use client';

import { useState } from 'react';
import Link from '@/components/ui/app-link';
import { ChevronDown, ChevronLeft, Loader2, LogOut, Monitor, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { jsonFetcher, ApiError } from '@/lib/query-fetch';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { GroupedSection } from '@/components/settings/grouped-section';
import { ApiTokensSection } from '@/components/settings/api-tokens-section';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { endSessionInThisBrowser } from '@/lib/client-cache';
import { Label } from '@/components/ui/label';
import { formatDate, formatDateTime } from '@/lib/date-format';

interface Session {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  ip: string | null;
  label: string | null;
  isCurrent: boolean;
}

interface SessionPage {
  total: number;
  sessions: Session[];
  hasMore: boolean;
}

// One person's sessions. The server sends the first page of each group and
// pages the rest per person, so one busy account can't bury everyone else.
interface SessionGroup extends SessionPage {
  userId: string;
  ownerName: string;
  isOwn: boolean;
}

function parseUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const isMobile = /Mobile|Android|iPhone|iPad|iPod/.test(ua);
  let platform = 'Unknown';
  if (/iPhone/.test(ua)) platform = 'iPhone';
  else if (/iPad/.test(ua)) platform = 'iPad';
  else if (/Android/.test(ua)) platform = 'Android';
  else if (/Macintosh|Mac OS X/.test(ua)) platform = 'Mac';
  else if (/Windows NT/.test(ua)) platform = 'Windows';
  else if (/Linux/.test(ua)) platform = 'Linux';

  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  return `${platform} · ${browser}${isMobile && platform === 'Unknown' ? ' (mobile)' : ''}`;
}

function displayName(s: Session): string {
  if (s.label && s.label.trim()) return s.label.trim();
  return parseUserAgent(s.userAgent);
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'Never';
  const diff = Date.now() - t;
  if (diff < 0) return formatDateTime(iso);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return formatDate(iso);
}

const REVOKE_TIMEOUT_MS = 5_000;
const GATEWAY_STATUSES = new Set([502, 503, 504]);

class RevokeRefusedError extends Error {
  constructor() {
    super('Failed to revoke session');
  }
}

interface SessionGroupSectionProps {
  group: SessionGroup;
  loadedAt: number;
  busy: boolean;
  onRename: (session: Session) => void;
  onRevoke: (session: Session) => void;
}

function SessionGroupSection({ group, loadedAt, busy, onRename, onRevoke }: SessionGroupSectionProps) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.userSessions(group.userId),
    queryFn: ({ pageParam, signal }) =>
      jsonFetcher<SessionPage>(
        `/api/sessions?userId=${encodeURIComponent(group.userId)}&skip=${pageParam}`
      )({ signal }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // An empty page ends it even if the total over-reports, so "Show more"
      // never refetches the same offset.
      if (!lastPage.hasMore || lastPage.sessions.length === 0) return undefined;
      return allPages.reduce((n, p) => n + p.sessions.length, 0);
    },
    // The list already carried this group's first page.
    initialData: { pages: [group], pageParams: [0] },
    initialDataUpdatedAt: loadedAt,
  });
  const pages = query.data?.pages ?? [group];
  // A sign-in between pages shifts the offsets by one; drop the repeat.
  const sessions = [...new Map(pages.flatMap((p) => p.sessions).map((s) => [s.id, s])).values()];
  const total = pages[pages.length - 1]?.total ?? group.total;
  const title = group.isOwn ? 'Your sessions' : group.ownerName;

  return (
    <GroupedSection title={`${title} · ${total}`}>
      {sessions.map((s) => (
        <QuickContextMenu
          key={s.id}
          label={`${displayName(s)} actions`}
          actions={[
            {
              id: 'rename',
              label: 'Rename session',
              icon: <Pencil />,
              disabled: busy,
              onSelect: () => onRename(s),
            },
            {
              id: 'revoke',
              label: s.isCurrent ? 'Sign out this device' : 'Revoke session',
              icon: <LogOut />,
              destructive: true,
              disabled: busy,
              onSelect: () => onRevoke(s),
            },
          ]}
        >
          <div className="grouped-row gap-2 py-1.5 pr-2">
            <div className="min-w-0 flex-1">
              {/* The device name gives way, so "This device" is never cut on a narrow phone. */}
              <div className="flex min-w-0 text-sm font-medium">
                <span className="truncate">{displayName(s)}</span>
                {s.isCurrent && <span className="shrink-0 whitespace-pre text-primary font-normal"> · This device</span>}
              </div>
              {/* Two lines, so a phone shows the sign-in date instead of cutting it off. */}
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                {[`Seen ${relativeTime(s.lastSeenAt)}`, s.ip].filter(Boolean).join(' · ')}
              </div>
              <div className="text-xs text-muted-foreground truncate" title={formatDateTime(s.createdAt)}>
                Signed in {formatDate(s.createdAt)}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0"
              aria-label={`Rename ${displayName(s)}`}
              onClick={() => onRename(s)}
              disabled={busy}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0 text-destructive hover:text-destructive"
              aria-label={s.isCurrent ? 'Sign out this device' : `Revoke ${displayName(s)}`}
              onClick={() => onRevoke(s)}
              disabled={busy}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </QuickContextMenu>
      ))}
      {query.hasNextPage && (
        <button
          type="button"
          className="grouped-row w-full justify-center! gap-2 text-sm text-primary disabled:opacity-60"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {query.isFetchingNextPage ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
          Show more ({sessions.length} of {total})
        </button>
      )}
    </GroupedSection>
  );
}

export default function SessionsPage() {
  const queryClient = useQueryClient();
  const [confirmTarget, setConfirmTarget] = useState<Session | null>(null);
  const [confirmOthers, setConfirmOthers] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Session | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const {
    data,
    dataUpdatedAt,
    isError,
    error: queryError,
  } = useQuery({
    queryKey: queryKeys.sessions(),
    queryFn: jsonFetcher<{ groups: SessionGroup[] }>('/api/sessions'),
    // "Seen 24s ago" and new sign-ins stay true while the page is open.
    refetchInterval: 30_000,
  });
  const groups = data?.groups ?? null;
  const error = isError
    ? queryError instanceof ApiError
      ? `HTTP ${queryError.status}`
      : queryError instanceof Error
        ? queryError.message
        : 'Failed to load sessions'
    : null;

  const revokeMutation = useMutation({
    mutationFn: async (session: Session) => {
      try {
        // Bounded like Account sign-out; the limit covers reading the body too.
        const res = await fetch(`/api/sessions/${session.id}/revoke`, {
          method: 'POST',
          signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
        });
        // A gateway error may come after the server already revoked it.
        if (!res.ok && !GATEWAY_STATUSES.has(res.status)) throw new RevokeRefusedError();
        if (!res.ok) throw new Error('Revoke response lost at the gateway');
        return (await res.json()) as { wasCurrent?: boolean };
      } catch (error) {
        // A lost or unreadable response is indeterminate: the server may have
        // revoked this browser's session already. As with Account sign-out,
        // end it here too rather than keep a possibly dead session's data.
        if (session.isCurrent && !(error instanceof RevokeRefusedError)) return { wasCurrent: true };
        throw error;
      }
    },
    onSuccess: (data, session) => {
      if (data.wasCurrent) {
        // This browser's own session ended: clear it like Account sign-out
        // before Login, so the next user here never sees this one's data.
        endSessionInThisBrowser();
        return;
      }
      toast.success(`Revoked ${displayName(session)}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    },
    onError: () => toast.error('Failed to revoke session'),
    onSettled: () => setConfirmTarget(null),
  });

  const revokeOthersMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/sessions/revoke-others', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to revoke other sessions');
      return (await res.json()) as { revoked: number };
    },
    onSuccess: (data) => {
      toast.success(
        data.revoked === 0
          ? 'No other sessions to revoke'
          : `Revoked ${data.revoked} session${data.revoked === 1 ? '' : 's'}`
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    },
    onError: () => toast.error('Failed to revoke other sessions'),
    onSettled: () => setConfirmOthers(false),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, label }: { id: string; label: string | null }) => {
      const res = await fetch(`/api/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw new Error('Failed to rename');
    },
    onSuccess: () => {
      toast.success('Renamed');
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    },
    onError: () => toast.error('Failed to rename'),
    onSettled: () => {
      setRenameTarget(null);
      setRenameValue('');
    },
  });

  const busy = revokeMutation.isPending || revokeOthersMutation.isPending || renameMutation.isPending;

  function handleRevoke(session: Session) {
    return revokeMutation.mutateAsync(session).catch(() => {});
  }

  function handleRevokeOthers() {
    return revokeOthersMutation.mutateAsync().catch(() => {});
  }

  function handleRename() {
    if (!renameTarget) return;
    renameMutation.mutate({ id: renameTarget.id, label: renameValue.trim() || null });
  }

  // "Revoke all other sessions" only touches the viewer's own devices, so the
  // count is the viewer's own group less this session, not every row shown.
  const ownGroup = groups?.find((g) => g.isOwn);
  const otherCount = ownGroup ? Math.max(0, ownGroup.total - 1) : 0;

  function startRename(session: Session) {
    setRenameTarget(session);
    setRenameValue(session.label ?? '');
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
        <h1 className="text-2xl font-semibold">Sessions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Devices and browsers currently signed in. Revoke any to force logout.
        </p>
      </div>

      {error && (
        <GroupedSection>
          <div className="px-4 py-3 text-sm text-red-400">{error}</div>
        </GroupedSection>
      )}

      {/* Tokens first: a long session list would otherwise bury them. */}
      <ApiTokensSection />

      {groups === null && !error ? (
        <GroupedSection>
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Loading sessions…
          </div>
        </GroupedSection>
      ) : (
        groups?.map((group) => (
          <SessionGroupSection
            key={group.userId}
            group={group}
            loadedAt={dataUpdatedAt}
            busy={busy}
            onRename={startRename}
            onRevoke={setConfirmTarget}
          />
        ))
      )}

      {groups && otherCount > 0 && (
        <GroupedSection footer="Revoked sessions are signed out on their next request.">
          <div className="px-4 py-3">
            <Button
              variant="outline"
              className="w-full h-9 text-destructive hover:text-destructive"
              onClick={() => setConfirmOthers(true)}
              disabled={busy}
            >
              <Monitor className="mr-2 h-4 w-4" />
              Revoke all other sessions
            </Button>
          </div>
        </GroupedSection>
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmTarget(null);
        }}
        title={
          confirmTarget
            ? confirmTarget.isCurrent
              ? 'Sign out of this device?'
              : `Revoke ${displayName(confirmTarget)}?`
            : 'Revoke session?'
        }
        description={
          confirmTarget && confirmTarget.isCurrent
            ? 'You will be returned to the login screen.'
            : 'This session will be signed out on its next request.'
        }
        confirmLabel={confirmTarget?.isCurrent ? 'Sign out' : 'Revoke'}
        destructive
        busy={busy}
        onConfirm={async () => {
          if (confirmTarget) await handleRevoke(confirmTarget);
        }}
      />

      <ConfirmDialog
        open={confirmOthers}
        onOpenChange={setConfirmOthers}
        title="Revoke all other sessions?"
        description="Every device other than this one will be signed out on its next request."
        confirmLabel="Revoke all"
        destructive
        busy={busy}
        onConfirm={async () => {
          await handleRevokeOthers();
        }}
      />

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRenameTarget(null);
            setRenameValue('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="session-label">Label</Label>
            <Input
              id="session-label"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={renameTarget ? parseUserAgent(renameTarget.userAgent) : ''}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to use the auto-detected device name.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={busy}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
