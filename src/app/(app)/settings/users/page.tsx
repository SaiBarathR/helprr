'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { GroupedSection } from '@/components/settings/grouped-section';
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
import { CAPABILITY_GROUPS, type Capability } from '@/lib/capabilities';

interface SafeUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  status: 'active' | 'pending' | 'disabled';
  template: string;
  jellyfinUserId: string | null;
  seerrUserId: string | null;
  hasPassword: boolean;
  hasJellyfinLink: boolean;
  createdAt: string;
}

interface ExternalUser {
  id: string;
  name: string;
}

const NONE = '__none__';

export default function UsersAdminPage() {
  const [users, setUsers] = useState<SafeUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SafeUser | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SafeUser | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUsers((await res.json()) as SafeUser[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(user: SafeUser) {
    const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error ?? 'Failed to delete user');
      return;
    }
    toast.success(`Deleted ${user.displayName}`);
    setConfirmDelete(null);
    await load();
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

      <div className="px-4 mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Household members, roles, and per-page permissions.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add
        </Button>
      </div>

      {error && (
        <GroupedSection>
          <div className="px-4 py-3 text-sm text-red-400">{error}</div>
        </GroupedSection>
      )}

      {users === null && !error ? (
        <GroupedSection>
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Loading users…
          </div>
        </GroupedSection>
      ) : (
        <GroupedSection>
          {users?.map((u) => (
            <button
              key={u.id}
              className="grouped-row w-full text-left hover:bg-[oklch(1_0_0/3%)] transition-colors"
              onClick={() => setEditing(u)}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {u.displayName}{' '}
                  <span className="text-muted-foreground font-normal">@{u.username}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 capitalize">
                  {u.role}
                  {u.status !== 'active' ? ` · ${u.status}` : ''}
                  {u.hasJellyfinLink ? ' · Jellyfin linked' : ''}
                </div>
              </div>
            </button>
          ))}
          {users?.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No users yet.
            </div>
          )}
        </GroupedSection>
      )}

      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      )}

      {editing && (
        <EditUserDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void load();
          }}
          onRequestDelete={(u) => {
            setEditing(null);
            setConfirmDelete(u);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={confirmDelete ? `Delete ${confirmDelete.displayName}?` : 'Delete user?'}
        description="This removes the account and all of its personal data (watchlist, devices, sessions)."
        confirmLabel="Delete"
        destructive
        onConfirm={() => (confirmDelete ? handleDelete(confirmDelete) : Promise.resolve())}
      />
    </div>
  );
}

function useExternalUsers(open: boolean) {
  const [jellyfin, setJellyfin] = useState<ExternalUser[]>([]);
  const [seerr, setSeerr] = useState<ExternalUser[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/jellyfin/users');
        if (res.ok && !cancelled) {
          // The endpoint returns { users: [...] }, not a bare array.
          const data = (await res.json()) as { users?: Array<{ Id?: string; Name?: string }> };
          const list = Array.isArray(data?.users) ? data.users : [];
          setJellyfin(
            list
              .filter((u) => u.Id && u.Name)
              .map((u) => ({ id: u.Id as string, name: u.Name as string }))
          );
        }
      } catch {
        /* Jellyfin not configured — leave empty */
      }
      try {
        const res = await fetch('/api/seerr/users');
        if (res.ok && !cancelled) {
          const raw = (await res.json()) as { results?: Array<{ id?: number; displayName?: string; username?: string }> } | Array<{ id?: number; displayName?: string; username?: string }>;
          const list = Array.isArray(raw) ? raw : raw.results ?? [];
          setSeerr(
            list
              .filter((u) => u.id != null)
              .map((u) => ({ id: String(u.id), name: u.displayName || u.username || `User ${u.id}` }))
          );
        }
      } catch {
        /* Seerr not configured — leave empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  return { jellyfin, seerr };
}

function ExternalLinkFields({
  jellyfinUserId,
  seerrUserId,
  onJellyfin,
  onSeerr,
}: {
  jellyfinUserId: string | null;
  seerrUserId: string | null;
  onJellyfin: (v: string | null) => void;
  onSeerr: (v: string | null) => void;
}) {
  const { jellyfin, seerr } = useExternalUsers(true);
  return (
    <>
      <div className="space-y-2">
        <Label>Jellyfin account</Label>
        <Select
          value={jellyfinUserId ?? NONE}
          onValueChange={(v) => onJellyfin(v === NONE ? null : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Not linked" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not linked</SelectItem>
            {jellyfin.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
            {jellyfinUserId && !jellyfin.some((u) => u.id === jellyfinUserId) && (
              <SelectItem value={jellyfinUserId}>{jellyfinUserId} (current)</SelectItem>
            )}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Enables &quot;Sign in with Jellyfin&quot; and scopes their Jellyfin data.
        </p>
      </div>
      <div className="space-y-2">
        <Label>Seerr account</Label>
        <Select value={seerrUserId ?? NONE} onValueChange={(v) => onSeerr(v === NONE ? null : v)}>
          <SelectTrigger>
            <SelectValue placeholder="Not linked" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not linked</SelectItem>
            {seerr.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
            {seerrUserId && !seerr.some((u) => u.id === seerrUserId) && (
              <SelectItem value={seerrUserId}>{seerrUserId} (current)</SelectItem>
            )}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Requests are attributed to this Seerr user and counted against their quota.
        </p>
      </div>
    </>
  );
}

function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [jellyfinUserId, setJellyfinUserId] = useState<string | null>(null);
  const [seerrUserId, setSeerrUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          displayName,
          password: password || undefined,
          role,
          template: role,
          jellyfinUserId,
          seerrUserId,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? 'Failed to create user');
        return;
      }
      toast.success('User created');
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cu-username">Username</Label>
            <Input id="cu-username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cu-name">Display name</Label>
            <Input id="cu-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cu-pw">Password</Label>
            <Input
              id="cu-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank for Jellyfin-only sign in"
            />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'member')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ExternalLinkFields
            jellyfinUserId={jellyfinUserId}
            seerrUserId={seerrUserId}
            onJellyfin={setJellyfinUserId}
            onSeerr={setSeerrUserId}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  onClose,
  onSaved,
  onRequestDelete,
}: {
  user: SafeUser;
  onClose: () => void;
  onSaved: () => void;
  onRequestDelete: (u: SafeUser) => void;
}) {
  const [username, setUsername] = useState(user.username);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<'admin' | 'member'>(user.role);
  const [status, setStatus] = useState<'active' | 'pending' | 'disabled'>(user.status);
  const [password, setPassword] = useState('');
  const [jellyfinUserId, setJellyfinUserId] = useState<string | null>(user.jellyfinUserId);
  const [seerrUserId, setSeerrUserId] = useState<string | null>(user.seerrUserId);
  const [busy, setBusy] = useState(false);

  // Permissions editor state.
  const [template, setTemplate] = useState(user.template);
  const [effective, setEffective] = useState<Partial<Record<Capability, boolean>> | null>(null);
  const [permBusy, setPermBusy] = useState(false);

  const loadPerms = useCallback(async () => {
    const res = await fetch(`/api/users/${user.id}/permissions`);
    if (res.ok) {
      const data = (await res.json()) as {
        template: string;
        effective: Partial<Record<Capability, boolean>>;
      };
      setTemplate(data.template);
      setEffective(data.effective);
    }
  }, [user.id]);

  useEffect(() => {
    void loadPerms();
  }, [loadPerms]);

  const isAdmin = role === 'admin';

  async function saveIdentity() {
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          displayName,
          role,
          status,
          jellyfinUserId,
          seerrUserId,
          password: password || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? 'Failed to save user');
        return;
      }
      toast.success('Saved');
      setPassword('');
      onSaved();
      // Role change realigns template/overrides server-side; reload the editor.
      await loadPerms();
    } finally {
      setBusy(false);
    }
  }

  async function applyTemplate(next: string) {
    setPermBusy(true);
    try {
      const res = await fetch(`/api/users/${user.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: next }),
      });
      if (!res.ok) {
        toast.error('Failed to apply template');
        return;
      }
      const data = (await res.json()) as {
        template: string;
        effective: Partial<Record<Capability, boolean>>;
      };
      setTemplate(data.template);
      setEffective(data.effective);
      toast.success('Template applied');
    } finally {
      setPermBusy(false);
    }
  }

  async function toggleCap(cap: Capability, value: boolean) {
    if (!effective) return;
    const next = { ...effective, [cap]: value };
    setEffective(next);
    setPermBusy(true);
    try {
      const res = await fetch(`/api/users/${user.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: next }),
      });
      if (!res.ok) {
        toast.error('Failed to update permission');
        setEffective(effective); // revert
        return;
      }
      const data = (await res.json()) as { effective: Partial<Record<Capability, boolean>> };
      setEffective(data.effective);
    } finally {
      setPermBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {user.displayName} <span className="text-muted-foreground font-normal">@{user.username}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="eu-username">Username</Label>
            <Input id="eu-username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="eu-name">Display name</Label>
            <Input id="eu-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'member')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="eu-pw">Reset password</Label>
            <Input
              id="eu-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep current"
            />
          </div>
          <ExternalLinkFields
            jellyfinUserId={jellyfinUserId}
            seerrUserId={seerrUserId}
            onJellyfin={setJellyfinUserId}
            onSeerr={setSeerrUserId}
          />
          <Button onClick={saveIdentity} disabled={busy} className="w-full">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save details
          </Button>
        </div>

        <div className="mt-4 border-t border-border pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label>Permissions</Label>
            <Select value={template} onValueChange={(v) => void applyTemplate(v)} disabled={permBusy || isAdmin}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member template</SelectItem>
                <SelectItem value="admin">Admin template</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isAdmin ? (
            <p className="text-xs text-muted-foreground">
              Admins always have every capability and can&apos;t be restricted.
            </p>
          ) : effective === null ? (
            <div className="py-4 text-center">
              <Loader2 className="h-4 w-4 animate-spin mx-auto" />
            </div>
          ) : (
            CAPABILITY_GROUPS.map((group) => (
              <div key={group.id} className="space-y-1">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">
                  {group.title}
                </div>
                {group.items.map((item) => (
                  <div key={item.cap} className="flex items-center justify-between py-1.5">
                    <span className="text-sm pr-3">{item.label}</span>
                    <Switch
                      checked={effective[item.cap as Capability] === true}
                      onCheckedChange={(v) => void toggleCap(item.cap as Capability, v)}
                      disabled={permBusy}
                      aria-label={item.label}
                    />
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => onRequestDelete(user)}
            disabled={busy}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
