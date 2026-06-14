'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { jsonFetcher, ApiError } from '@/lib/query-fetch';
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
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SafeUser | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SafeUser | null>(null);

  const {
    data: users = null,
    isError,
    error: queryError,
  } = useQuery({
    queryKey: queryKeys.users(),
    queryFn: jsonFetcher<SafeUser[]>('/api/users'),
  });
  const error = isError
    ? queryError instanceof ApiError
      ? `HTTP ${queryError.status}`
      : queryError instanceof Error
        ? queryError.message
        : 'Failed to load users'
    : null;

  const deleteMutation = useMutation({
    mutationFn: async (user: SafeUser) => {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'Failed to delete user');
      }
    },
    onSuccess: (_data, user) => {
      toast.success(`Deleted ${user.displayName}`);
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.users() });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to delete user'),
  });

  function handleDelete(user: SafeUser) {
    return deleteMutation.mutateAsync(user).catch(() => {});
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
            void queryClient.invalidateQueries({ queryKey: queryKeys.users() });
          }}
        />
      )}

      {editing && (
        <EditUserDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.users() });
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
  // Both services may be unconfigured; the queries tolerate failure and fall
  // back to [] (the global onError only redirects on 401, not 4xx/5xx here —
  // and these endpoints 200 with empty when unconfigured). The `.data ?? []`
  // keeps an unconfigured/erroring service from breaking the dialog.
  const { data: jellyfin } = useQuery({
    queryKey: ['jellyfin', 'users'],
    queryFn: jsonFetcher<{ users?: Array<{ Id?: string; Name?: string }> }>('/api/jellyfin/users'),
    enabled: open,
    retry: false,
    select: (data): ExternalUser[] =>
      (Array.isArray(data?.users) ? data.users : [])
        .filter((u) => u.Id && u.Name)
        .map((u) => ({ id: u.Id as string, name: u.Name as string })),
  });
  const { data: seerr } = useQuery({
    queryKey: ['seerr', 'users'],
    queryFn: jsonFetcher<
      | { results?: Array<{ id?: number; displayName?: string; username?: string }> }
      | Array<{ id?: number; displayName?: string; username?: string }>
    >('/api/seerr/users'),
    enabled: open,
    retry: false,
    select: (raw): ExternalUser[] => {
      const list = Array.isArray(raw) ? raw : raw.results ?? [];
      return list
        .filter((u) => u.id != null)
        .map((u) => ({ id: String(u.id), name: u.displayName || u.username || `User ${u.id}` }));
    },
  });

  return { jellyfin: jellyfin ?? [], seerr: seerr ?? [] };
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

  const createMutation = useMutation({
    mutationFn: async () => {
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
        throw new Error(data.error ?? 'Failed to create user');
      }
    },
    onSuccess: () => {
      toast.success('User created');
      onCreated();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to create user'),
  });
  const busy = createMutation.isPending;

  function submit() {
    createMutation.mutate();
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
  const queryClient = useQueryClient();
  const [username, setUsername] = useState(user.username);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<'admin' | 'member'>(user.role);
  const [status, setStatus] = useState<'active' | 'pending' | 'disabled'>(user.status);
  const [password, setPassword] = useState('');
  const [jellyfinUserId, setJellyfinUserId] = useState<string | null>(user.jellyfinUserId);
  const [seerrUserId, setSeerrUserId] = useState<string | null>(user.seerrUserId);

  // Permissions editor state. Seeded from the permissions query, then driven by
  // the template/toggle mutations (which return the authoritative effective set).
  const [template, setTemplate] = useState(user.template);
  const [effective, setEffective] = useState<Partial<Record<Capability, boolean>> | null>(null);

  const permsQuery = useQuery({
    queryKey: ['users', 'permissions', user.id],
    queryFn: jsonFetcher<{
      template: string;
      effective: Partial<Record<Capability, boolean>>;
    }>(`/api/users/${user.id}/permissions`),
  });

  useEffect(() => {
    if (permsQuery.data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seed editable state from the permissions query
      setTemplate(permsQuery.data.template);
      setEffective(permsQuery.data.effective);
    }
  }, [permsQuery.data]);

  const isAdmin = role === 'admin';

  const saveIdentityMutation = useMutation({
    mutationFn: async () => {
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
        throw new Error(data.error ?? 'Failed to save user');
      }
    },
    onSuccess: () => {
      toast.success('Saved');
      setPassword('');
      onSaved();
      // Role change realigns template/overrides server-side; reload the editor.
      queryClient.invalidateQueries({
        queryKey: ['users', 'permissions', user.id],
      });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to save user'),
  });
  const busy = saveIdentityMutation.isPending;

  const applyTemplateMutation = useMutation({
    mutationFn: async (next: string) => {
      const res = await fetch(`/api/users/${user.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: next }),
      });
      if (!res.ok) throw new Error('Failed to apply template');
      return (await res.json()) as {
        template: string;
        effective: Partial<Record<Capability, boolean>>;
      };
    },
    onSuccess: (data) => {
      setTemplate(data.template);
      setEffective(data.effective);
      toast.success('Template applied');
    },
    onError: () => toast.error('Failed to apply template'),
  });

  const toggleCapMutation = useMutation({
    mutationFn: async (next: Partial<Record<Capability, boolean>>) => {
      const res = await fetch(`/api/users/${user.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: next }),
      });
      if (!res.ok) throw new Error('Failed to update permission');
      return (await res.json()) as { effective: Partial<Record<Capability, boolean>> };
    },
    onSuccess: (data) => setEffective(data.effective),
  });

  const permBusy = applyTemplateMutation.isPending || toggleCapMutation.isPending;

  function saveIdentity() {
    saveIdentityMutation.mutate();
  }

  function applyTemplate(next: string) {
    applyTemplateMutation.mutate(next);
  }

  function toggleCap(cap: Capability, value: boolean) {
    if (!effective) return;
    const prev = effective;
    const next = { ...effective, [cap]: value };
    setEffective(next); // optimistic
    toggleCapMutation.mutate(next, {
      onError: () => {
        toast.error('Failed to update permission');
        setEffective(prev); // revert
      },
    });
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
