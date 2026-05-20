'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
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

interface JellyfinUserOption {
  id: string;
  name: string;
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

  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [username, setUsername] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [jellyfinValidated, setJellyfinValidated] = useState<{ userId: string } | null>(null);
  const [jellyfinUsers, setJellyfinUsers] = useState<JellyfinUserOption[]>([]);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingExternalUrl, setSavingExternalUrl] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/services');
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const data = (await res.json()) as Array<{
          type?: string;
          url?: string;
          apiKey?: string;
          username?: string | null;
          externalUrl?: string | null;
        }>;
        const existing = data.find((c) => c.type === type);
        if (existing) {
          if (!cancelled) {
            setUrl(existing.url ?? '');
            setApiKey(existing.apiKey ?? '');
            setUsername(existing.username ?? '');
            setExternalUrl(existing.externalUrl ?? '');
            setConfigured(true);
            if (isJellyfin && existing.username) {
              setJellyfinValidated({ userId: existing.username });
            }
          }
          if (isJellyfin && existing.url && existing.apiKey) {
            try {
              const usersRes = await fetch('/api/jellyfin/users');
              if (usersRes.ok) {
                const usersData = await usersRes.json();
                const rawUsers: unknown[] = Array.isArray((usersData as { users?: unknown }).users)
                  ? (usersData as { users: unknown[] }).users
                  : [];
                const options = mapJellyfinUsers(rawUsers);
                if (existing.username && !options.some((u) => u.id === existing.username)) {
                  options.unshift({ id: existing.username, name: `Saved User (${existing.username})` });
                }
                if (!cancelled) setJellyfinUsers(options);
              }
            } catch {
              // noop
            }
          }
        }
      } catch {
        // noop
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [type, isJellyfin]);

  async function handleTest() {
    if (!url || !apiKey) {
      toast.error(isQbt ? 'Please enter URL and Password' : 'Please enter both URL and API Key');
      return;
    }
    setTesting(true);
    try {
      const res = await fetch('/api/services/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          url,
          apiKey,
          ...(isQbt && { username: username || 'admin' }),
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (isJellyfin && data.userId) {
          const rawUsers: unknown[] = Array.isArray((data as { users?: unknown }).users)
            ? (data as { users: unknown[] }).users
            : [];
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
    } catch {
      if (isJellyfin) {
        setJellyfinValidated(null);
        setJellyfinUsers([]);
      }
      toast.error('Failed to test connection');
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!url || !apiKey) {
      toast.error(isQbt ? 'Please enter URL and Password' : 'Please enter both URL and API Key');
      return;
    }
    if (isJellyfin && !jellyfinValidated) {
      toast.error('Please test Jellyfin with an admin API key before saving');
      return;
    }
    if (isJellyfin && !username) {
      toast.error('Please select a Jellyfin user');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, string> = { type, url, apiKey };
      if (isQbt) body.username = username || 'admin';
      else if (isJellyfin && jellyfinValidated) body.username = username || jellyfinValidated.userId;

      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setConfigured(true);
        invalidateExternalUrls();
        toast.success('Connection saved');
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to save connection');
      }
    } catch {
      toast.error('Failed to save connection');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveExternalUrl() {
    setSavingExternalUrl(true);
    try {
      const res = await fetch('/api/services/external-url', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, externalUrl: externalUrl.trim() }),
      });
      if (res.ok) {
        invalidateExternalUrls();
        toast.success('External URL saved');
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || 'Failed to save external URL');
      }
    } catch {
      toast.error('Failed to save external URL');
    } finally {
      setSavingExternalUrl(false);
    }
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
        <div className="px-4 py-3 border-b border-[oklch(1_0_0/6%)] space-y-1.5">
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
            <div className="px-4 py-3 border-b border-[oklch(1_0_0/6%)] space-y-1.5">
              <Label className="text-xs text-muted-foreground">Username</Label>
              <Input
                placeholder="admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="px-4 py-3 border-b border-[oklch(1_0_0/6%)] space-y-1.5">
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
            <div className="px-4 py-3 border-b border-[oklch(1_0_0/6%)] space-y-1.5">
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
              <div className="px-4 py-3 border-b border-[oklch(1_0_0/6%)] space-y-1.5">
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
