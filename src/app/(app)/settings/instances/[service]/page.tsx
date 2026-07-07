'use client';

import { useEffect, useState, use } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { handleAuthError } from '@/lib/query-client';
import Link from 'next/link';
import { notFound, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronLeft, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GroupedSection } from '@/components/settings/grouped-section';
import { findServiceBySlug, type ServiceConfigType } from '@/lib/settings/service-config';
import { invalidateExternalUrls } from '@/lib/hooks/use-external-urls';
import { invalidateInstances } from '@/lib/query-invalidation';

interface JellyfinUserOption {
  id: string;
  name: string;
}

interface ServiceRecord {
  id?: string;
  type?: string;
  label?: string;
  isDefault?: boolean;
  url?: string;
  apiKey?: string;
  username?: string | null;
  externalUrl?: string | null;
}

interface JellyfinApiUser {
  Id: string;
  Name: string;
  Policy?: {
    IsHidden?: boolean;
    IsDisabled?: boolean;
  };
}

function isJellyfinApiUser(value: unknown): value is JellyfinApiUser {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { Id?: unknown }).Id === 'string' &&
    typeof (value as { Name?: unknown }).Name === 'string'
  );
}

function isJellyfinUserOption(value: unknown): value is JellyfinUserOption {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}

function mapJellyfinUsers(rawUsers: unknown[]): JellyfinUserOption[] {
  const mapped = rawUsers.flatMap((value): JellyfinUserOption[] => {
    if (isJellyfinApiUser(value)) {
      if (value.Policy?.IsHidden || value.Policy?.IsDisabled) return [];
      return [{ id: value.Id, name: value.Name }];
    }
    if (isJellyfinUserOption(value)) {
      return [{ id: value.id, name: value.name }];
    }
    return [];
  });
  const unique = new Map<string, JellyfinUserOption>();
  for (const o of mapped) {
    if (!unique.has(o.id)) unique.set(o.id, o);
  }
  return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export default function ServiceDetailPage({ params }: { params: Promise<{ service: string }> }) {
  const { service: slug } = use(params);
  const config = findServiceBySlug(slug);
  if (!config) notFound();

  const type: ServiceConfigType = config.type;
  const isQbt = type === 'QBITTORRENT';
  const isJellyfin = type === 'JELLYFIN';

  const searchParams = useSearchParams();
  const router = useRouter();
  const instanceParam = searchParams.get('instance'); // null | "new" | "<id>"
  const isMultiInstance = config.supportsMultiInstance === true;
  const editingId = isMultiInstance && instanceParam && instanceParam !== 'new' ? instanceParam : null;

  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [username, setUsername] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [jellyfinValidated, setJellyfinValidated] = useState<{ userId: string } | null>(null);
  const [jellyfinUsers, setJellyfinUsers] = useState<JellyfinUserOption[]>([]);
  const [configured, setConfigured] = useState(false);
  const [editingConnId, setEditingConnId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const queryClient = useQueryClient();

  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: jsonFetcher<ServiceRecord[]>('/api/services'),
  });
  const loading = servicesQuery.isLoading;

  // The connection being edited, from the latest query data.
  const existingConn = servicesQuery.data
    ? (isMultiInstance
        ? (editingId ? servicesQuery.data.find((c) => c.id === editingId) : undefined)
        : servicesQuery.data.find((c) => c.type === type))
    : undefined;

  // Seed the form from the matching connection. Re-seeds when the edited entity
  // changes — keyed by the full route context (service type + instance param),
  // since client-side navigation between services reuses this component — but
  // not on a background refetch (which would clobber in-progress edits).
  // Always resets to defaults first so no state carries over from the previous
  // service/instance. Guarded during render.
  const seedKey = `${type}:${instanceParam ?? ''}`;
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (servicesQuery.data && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setEditingConnId(existingConn?.id ?? null);
    setLabel(existingConn?.label ?? '');
    setIsDefault(existingConn?.isDefault ?? false);
    setUrl(existingConn?.url ?? '');
    setApiKey(existingConn?.apiKey ?? '');
    setUsername(existingConn?.username ?? '');
    setExternalUrl(existingConn?.externalUrl ?? '');
    setConfigured(Boolean(existingConn));
    setJellyfinValidated(
      isJellyfin && existingConn?.username ? { userId: existingConn.username } : null
    );
  }

  // Load the Jellyfin user list for the saved connection (primitive deps so a
  // background refetch with unchanged values doesn't re-fire the fetch).
  const jfUrl = existingConn?.url;
  const jfApiKey = existingConn?.apiKey;
  const jfSavedUser = existingConn?.username;
  useEffect(() => {
    if (!isJellyfin || !jfUrl || !jfApiKey) return;
    void (async () => {
      try {
        const usersRes = await fetch('/api/jellyfin/users');
        if (usersRes.status === 401) {
          handleAuthError(new ApiError(401, 'Session expired'));
          return;
        }
        if (!usersRes.ok) return;
        const usersData = await usersRes.json();
        const rawUsers: unknown[] = Array.isArray((usersData as { users?: unknown }).users)
          ? (usersData as { users: unknown[] }).users
          : [];
        const options = mapJellyfinUsers(rawUsers);
        if (jfSavedUser && !options.some((u) => u.id === jfSavedUser)) {
          options.unshift({ id: jfSavedUser, name: `Saved User (${jfSavedUser})` });
        }
        setJellyfinUsers(options);
      } catch {
        // noop
      }
    })();
  }, [isJellyfin, jfUrl, jfApiKey, jfSavedUser]);

  const testMutation = useMutation({
    mutationFn: async (vars: { url: string; apiKey: string; username: string }) => {
      const res = await fetch('/api/services/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          url: vars.url,
          apiKey: vars.apiKey,
          // So a masked key is unmasked against THIS instance, not the type's default.
          ...(editingId && { instanceId: editingId }),
          ...(isQbt && { username: vars.username || 'admin' }),
        }),
      });
      // The test endpoint returns 200 with { success } even on a failed probe;
      // only a 401 means the session was revoked → redirect via the global handler.
      if (res.status === 401) throw new ApiError(401, 'Session expired');
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        if (isJellyfin && data.userId) {
          const rawUsers: unknown[] = Array.isArray(data.users) ? data.users : [];
          const users = mapJellyfinUsers(rawUsers);
          setJellyfinUsers(users);
          const selectedUserId = users.find((u) => u.id === username)?.id
            || users.find((u) => u.id === data.userId)?.id
            || users[0]?.id
            || data.userId;
          if (selectedUserId) {
            setUsername(selectedUserId);
            setJellyfinValidated({ userId: selectedUserId });
          } else {
            setJellyfinValidated({ userId: data.userId });
          }
        }
        toast.success(
          `Connection successful${data.version ? ` (v${data.version})` : ''}${data.serverName ? ` - ${data.serverName}` : ''}`,
          { icon: <CheckCircle className="h-4 w-4 text-green-500" /> },
        );
      } else {
        if (isJellyfin) {
          setJellyfinValidated(null);
          setJellyfinUsers([]);
        }
        toast.error(data.error || 'Connection failed', {
          icon: <XCircle className="h-4 w-4 text-red-500" />,
        });
      }
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      if (isJellyfin) {
        setJellyfinValidated(null);
        setJellyfinUsers([]);
      }
      toast.error('Failed to test connection');
    },
  });
  const testing = testMutation.isPending;

  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, string | boolean>) => {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new ApiError(res.status, data?.error || 'Failed to save connection');
      }
      return res.json().catch(() => null);
    },
    onSuccess: (saved, body) => {
      const wasNew = !body.id;
      if (saved?.id) setEditingConnId(saved.id);
      setConfigured(true);
      invalidateExternalUrls();
      invalidateInstances(queryClient);
      toast.success('Connection saved');
      if (isMultiInstance && wasNew) {
        router.push('/settings/instances');
      }
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Failed to save connection');
    },
  });
  const saving = saveMutation.isPending;

  const externalUrlMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/services/external-url', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingConnId, externalUrl: externalUrl.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new ApiError(res.status, data?.error || 'Failed to save external URL');
      }
    },
    onSuccess: () => {
      invalidateExternalUrls();
      toast.success('External URL saved');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Failed to save external URL');
    },
  });
  const savingExternalUrl = externalUrlMutation.isPending;

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/services/${editingConnId}`, { method: 'DELETE' });
      if (!res.ok) throw new ApiError(res.status, 'Failed to remove instance');
    },
    onSuccess: () => {
      toast.success('Instance removed');
      invalidateExternalUrls();
      invalidateInstances(queryClient);
      router.push('/settings/instances');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      toast.error('Failed to remove instance');
    },
  });

  const makeDefaultMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/services/${editingConnId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!res.ok) throw new ApiError(res.status, 'Failed to set default');
    },
    onSuccess: () => {
      toast.success('Set as default');
      setIsDefault(true);
      invalidateInstances(queryClient);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      toast.error('Failed to set default');
    },
  });

  function handleTest() {
    const trimmedUrl = url.trim();
    const trimmedKey = apiKey.trim();
    const trimmedUser = username?.trim() ?? '';
    if (!trimmedUrl || !trimmedKey) {
      toast.error(isQbt ? 'Please enter URL and Password' : 'Please enter both URL and API Key');
      return;
    }
    testMutation.mutate({ url: trimmedUrl, apiKey: trimmedKey, username: trimmedUser });
  }

  function handleSave() {
    const trimmedUrl = url.trim();
    const trimmedKey = apiKey.trim();
    const trimmedUser = username?.trim() ?? '';
    if (!trimmedUrl || !trimmedKey) {
      toast.error(isQbt ? 'Please enter URL and Password' : 'Please enter both URL and API Key');
      return;
    }
    if (isJellyfin && !jellyfinValidated) {
      toast.error('Please test Jellyfin with an admin API key before saving');
      return;
    }
    if (isJellyfin && !trimmedUser) {
      toast.error('Please select a Jellyfin user');
      return;
    }

    const body: Record<string, string | boolean> = { type, url: trimmedUrl, apiKey: trimmedKey };
    if (isMultiInstance) {
      if (!label.trim()) {
        toast.error('Please name this instance');
        return;
      }
      body.label = label.trim();
      if (editingConnId) body.id = editingConnId;
    }
    if (isQbt) body.username = trimmedUser || 'admin';
    else if (isJellyfin && jellyfinValidated) body.username = trimmedUser || jellyfinValidated.userId;

    saveMutation.mutate(body);
  }

  function handleSaveExternalUrl() {
    if (!editingConnId) {
      toast.error('Save the connection first');
      return;
    }
    externalUrlMutation.mutate();
  }

  function handleDelete() {
    if (!editingConnId) return;
    deleteMutation.mutate();
  }

  function handleMakeDefault() {
    if (!editingConnId) return;
    makeDefaultMutation.mutate();
  }

  const Icon = config.icon;

  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/settings/instances"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Instances
        </Link>
      </div>

      <div className="px-4 mb-4 flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${config.iconBg} ${config.iconColor}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">{config.label}</h1>
          <p className="text-xs text-muted-foreground">
            {loading ? 'Loading…' : configured ? 'Connected' : 'Not configured'}
          </p>
        </div>
      </div>

      <GroupedSection
        title="Connection"
        footer="Synced across devices · Validate with Test before saving"
      >
        {isMultiInstance && (
          <div className="px-4 py-3 border-b border-foreground/[0.06] space-y-1.5">
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input
              placeholder="e.g. 4K, Anime, Main"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-10"
            />
          </div>
        )}

        <div className="px-4 py-3 border-b border-foreground/[0.06] space-y-1.5">
          <Label className="text-xs text-muted-foreground">URL</Label>
          <Input
            placeholder={config.placeholder}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (isJellyfin) {
                setJellyfinValidated(null);
                setJellyfinUsers([]);
                setUsername('');
              }
            }}
            className="h-10"
          />
        </div>

        {isQbt ? (
          <>
            <div className="px-4 py-3 border-b border-foreground/[0.06] space-y-1.5">
              <Label className="text-xs text-muted-foreground">Username</Label>
              <Input
                placeholder="admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="px-4 py-3 border-b border-foreground/[0.06] space-y-1.5">
              <Label className="text-xs text-muted-foreground">Password</Label>
              <Input
                type="password"
                placeholder="Enter password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="h-10"
              />
            </div>
          </>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-foreground/[0.06] space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {isJellyfin ? 'API Key (Admin)' : 'API Key'}
              </Label>
              <Input
                type="password"
                placeholder={isJellyfin ? 'Enter Jellyfin API key' : 'Enter API key'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  if (isJellyfin) {
                    setJellyfinValidated(null);
                    setJellyfinUsers([]);
                    setUsername('');
                  }
                }}
                className="h-10"
              />
            </div>
            {isJellyfin && (
              <div className="px-4 py-3 border-b border-foreground/[0.06] space-y-1.5">
                <Label className="text-xs text-muted-foreground">Primary Default User</Label>
                <Select
                  value={username ?? ''}
                  onValueChange={setUsername}
                  disabled={!jellyfinValidated || jellyfinUsers.length === 0}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue
                      placeholder={
                        jellyfinUsers.length > 0
                          ? 'Select a Jellyfin user'
                          : 'Test connection to load users'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {jellyfinUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {jellyfinValidated ? (
                  <p className="text-xs text-green-500">Admin API key validated — ready to save</p>
                ) : apiKey ? (
                  <p className="text-xs text-muted-foreground">
                    Test connection to validate your API key before saving
                  </p>
                ) : null}
              </div>
            )}
          </>
        )}

        <div className="px-4 py-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-9"
            onClick={handleTest}
            disabled={testing || saving}
          >
            {testing ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Testing…
              </>
            ) : (
              'Test'
            )}
          </Button>
          <Button
            size="sm"
            className="flex-1 h-9"
            onClick={handleSave}
            disabled={testing || saving}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              'Save'
            )}
          </Button>
        </div>
      </GroupedSection>

      {isMultiInstance && editingConnId && (
        <GroupedSection title="Instance">
          <div className="px-4 py-3 flex gap-2">
            {!isDefault && (
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-9"
                onClick={handleMakeDefault}
              >
                Set as default
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-9 text-red-500 hover:text-red-500"
              onClick={handleDelete}
            >
              Delete instance
            </Button>
          </div>
        </GroupedSection>
      )}

      {config.supportsExternalUrl && configured && (
        <GroupedSection
          title="External URL"
          footer="Synced across devices · Used for “Open in” links on detail pages"
        >
          <div className="px-4 py-3 space-y-2">
            <Input
              placeholder={`https://${config.label.toLowerCase()}.example.com`}
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              className="h-10"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-9"
              onClick={handleSaveExternalUrl}
              disabled={savingExternalUrl}
            >
              {savingExternalUrl ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save external URL'
              )}
            </Button>
          </div>
        </GroupedSection>
      )}
    </div>
  );
}
