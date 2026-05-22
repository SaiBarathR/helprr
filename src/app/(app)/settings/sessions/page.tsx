'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Loader2, LogOut, Monitor, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { GroupedSection } from '@/components/settings/grouped-section';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Session {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  ip: string | null;
  label: string | null;
  isCurrent: boolean;
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
  if (diff < 0) return new Date(iso).toLocaleString();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<Session | null>(null);
  const [confirmOthers, setConfirmOthers] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Session | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Session[];
      setSessions(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRevoke(session: Session) {
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}/revoke`, { method: 'POST' });
      if (!res.ok) {
        toast.error('Failed to revoke session');
        return;
      }
      const data = (await res.json()) as { wasCurrent?: boolean };
      if (data.wasCurrent) {
        toast.success('Signed out');
        router.push('/login');
        return;
      }
      toast.success(`Revoked ${displayName(session)}`);
      await load();
    } finally {
      setBusy(false);
      setConfirmTarget(null);
    }
  }

  async function handleRevokeOthers() {
    setBusy(true);
    try {
      const res = await fetch('/api/sessions/revoke-others', { method: 'POST' });
      if (!res.ok) {
        toast.error('Failed to revoke other sessions');
        return;
      }
      const data = (await res.json()) as { revoked: number };
      toast.success(
        data.revoked === 0
          ? 'No other sessions to revoke'
          : `Revoked ${data.revoked} session${data.revoked === 1 ? '' : 's'}`
      );
      await load();
    } finally {
      setBusy(false);
      setConfirmOthers(false);
    }
  }

  async function handleRename() {
    if (!renameTarget) return;
    const labelToSave = renameValue.trim();
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${renameTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: labelToSave || null }),
      });
      if (!res.ok) {
        toast.error('Failed to rename');
        return;
      }
      toast.success('Renamed');
      await load();
    } finally {
      setBusy(false);
      setRenameTarget(null);
      setRenameValue('');
    }
  }

  const otherCount = (sessions ?? []).filter((s) => !s.isCurrent).length;

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

      {sessions === null && !error ? (
        <GroupedSection>
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Loading sessions…
          </div>
        </GroupedSection>
      ) : (
        sessions?.map((s) => (
          <GroupedSection
            key={s.id}
            title={s.isCurrent ? `${displayName(s)} · This device` : displayName(s)}
          >
            <div className="grouped-row">
              <span className="text-sm">Signed in</span>
              <span className="text-sm text-muted-foreground">
                {new Date(s.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="grouped-row">
              <span className="text-sm">Last seen</span>
              <span className="text-sm text-muted-foreground">{relativeTime(s.lastSeenAt)}</span>
            </div>
            {s.ip && (
              <div className="grouped-row">
                <span className="text-sm">IP</span>
                <span className="text-sm text-muted-foreground">{s.ip}</span>
              </div>
            )}
            <div className="px-4 py-3 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-9"
                onClick={() => {
                  setRenameTarget(s);
                  setRenameValue(s.label ?? '');
                }}
                disabled={busy}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Rename
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-9 text-destructive hover:text-destructive"
                onClick={() => setConfirmTarget(s)}
                disabled={busy}
              >
                <LogOut className="mr-2 h-4 w-4" />
                {s.isCurrent ? 'Sign out' : 'Revoke'}
              </Button>
            </div>
          </GroupedSection>
        ))
      )}

      {sessions && otherCount > 0 && (
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
        onConfirm={() => (confirmTarget ? handleRevoke(confirmTarget) : Promise.resolve())}
      />

      <ConfirmDialog
        open={confirmOthers}
        onOpenChange={setConfirmOthers}
        title="Revoke all other sessions?"
        description="Every device other than this one will be signed out on its next request."
        confirmLabel="Revoke all"
        destructive
        busy={busy}
        onConfirm={handleRevokeOthers}
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
