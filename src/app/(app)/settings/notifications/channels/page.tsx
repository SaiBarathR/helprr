'use client';

import { useState } from 'react';
import Link from '@/components/ui/app-link';
import { AlertTriangle, ChevronLeft, Loader2, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Switch } from '@/components/ui/switch';
import { GroupedSection } from '@/components/settings/grouped-section';
import { ChannelForm, type ChannelFormValues } from '@/components/notifications/channel-form';
import { jsonFetcher } from '@/lib/query-fetch';
import { formatDateTime } from '@/lib/date-format';
import {
  CHANNEL_CATALOG,
  MAX_CHANNELS_PER_USER,
  type ChannelSummary,
} from '@/lib/notification-channels/catalog';

interface ChannelsResponse {
  channels: ChannelSummary[];
  availableEvents: string[];
  overview?: { total: number; enabled: number; failing: number; people: number; byType: Record<string, number> };
}

const QUERY_KEY = ['notifications', 'channels'] as const;

async function sendJson(url: string, method: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export default function NotificationChannelsPage() {
  const queryClient = useQueryClient();
  const { data, isError } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: jsonFetcher<ChannelsResponse>('/api/notifications/channels'),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ChannelSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  async function create(values: ChannelFormValues) {
    try {
      await sendJson('/api/notifications/channels', 'POST', values);
      toast.success('Channel added');
      setAdding(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add the channel');
    }
  }

  async function save(channel: ChannelSummary, values: ChannelFormValues) {
    try {
      await sendJson(`/api/notifications/channels/${channel.id}`, 'PATCH', {
        name: values.name,
        events: values.events,
        config: values.config,
        secrets: values.secrets,
      });
      toast.success('Channel saved');
      setEditingId(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the channel');
    }
  }

  async function setEnabled(channel: ChannelSummary, enabled: boolean) {
    try {
      await sendJson(`/api/notifications/channels/${channel.id}`, 'PATCH', { enabled });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the channel');
    }
  }

  async function sendTest(channel: ChannelSummary) {
    setTestingId(channel.id);
    try {
      const result = (await sendJson(`/api/notifications/channels/${channel.id}/test`, 'POST')) as { ok?: boolean; error?: string };
      if (result.ok) toast.success(`Test sent to ${channel.name}`);
      else toast.error(`Test failed: ${result.error ?? 'unknown reason'}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTestingId(null);
    }
  }

  async function remove(channel: ChannelSummary) {
    setDeleting(true);
    try {
      await sendJson(`/api/notifications/channels/${channel.id}`, 'DELETE');
      toast.success(`Removed ${channel.name}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the channel');
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  const channels = data?.channels ?? null;
  const availableEvents = data?.availableEvents ?? [];
  const overview = data?.overview;

  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/settings/notifications"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Notifications
        </Link>
      </div>

      <div className="px-4 mb-4">
        <h1 className="text-2xl font-semibold">Other channels</h1>
        <p className="text-sm text-muted-foreground mt-1">
          ntfy, Gotify, Apprise, a webhook or email, for the events you pick. They follow your quiet hours.
        </p>
      </div>

      {isError && (
        <GroupedSection>
          <div className="px-4 py-3 text-sm text-red-400">Could not load your channels.</div>
        </GroupedSection>
      )}

      {overview && (
        <GroupedSection title="Everyone's channels" footer="Counts only. Each person manages their own channels.">
          <div className="grouped-row">
            <span className="text-sm">Channels</span>
            <span className="text-sm text-muted-foreground">{overview.total} ({overview.enabled} on)</span>
          </div>
          <div className="grouped-row">
            <span className="text-sm">People using them</span>
            <span className="text-sm text-muted-foreground">{overview.people}</span>
          </div>
          <div className="grouped-row">
            <span className="text-sm">Failing</span>
            <span className={overview.failing > 0 ? 'text-sm text-amber-400' : 'text-sm text-muted-foreground'}>{overview.failing}</span>
          </div>
          {Object.keys(overview.byType).length > 0 && (
            <div className="grouped-row">
              <span className="text-sm">By type</span>
              <span className="text-sm text-muted-foreground truncate max-w-[60%]">
                {Object.entries(overview.byType)
                  .map(([type, count]) => `${CHANNEL_CATALOG[type as keyof typeof CHANNEL_CATALOG]?.label ?? type} ${count}`)
                  .join(' · ')}
              </span>
            </div>
          )}
        </GroupedSection>
      )}

      {channels === null && !isError && (
        <GroupedSection>
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Loading channels…
          </div>
        </GroupedSection>
      )}

      {channels?.map((channel) => {
        const label = CHANNEL_CATALOG[channel.type]?.label ?? channel.type;
        if (editingId === channel.id) {
          return (
            <GroupedSection key={channel.id} title={`Edit ${channel.name}`}>
              <ChannelForm
                initial={channel}
                availableEvents={availableEvents}
                submitLabel="Save"
                onSubmit={(values) => save(channel, values)}
                onCancel={() => setEditingId(null)}
              />
            </GroupedSection>
          );
        }
        return (
          <GroupedSection key={channel.id} title={`${channel.name} · ${label}`}>
            <div className="grouped-row">
              <span className="text-sm">On</span>
              <Switch
                checked={channel.enabled}
                onCheckedChange={(v) => void setEnabled(channel, v)}
                aria-label={`Send to ${channel.name}`}
              />
            </div>
            <div className="grouped-row">
              <span className="text-sm">Sends to</span>
              <span className="text-sm text-muted-foreground truncate max-w-[60%]">{channel.destination || '—'}</span>
            </div>
            <div className="grouped-row">
              <span className="text-sm">Events</span>
              <span className="text-sm text-muted-foreground">{channel.events.length}</span>
            </div>
            <div className="grouped-row">
              <span className="text-sm">Last delivery</span>
              <span className="text-sm text-muted-foreground">
                {channel.lastSucceededAt ? formatDateTime(channel.lastSucceededAt) : 'Never'}
              </span>
            </div>
            {channel.lastError && (
              <div role="status" className="px-4 py-3 text-sm text-amber-400 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {channel.consecutiveFailures > 0
                    ? `Failing (${channel.consecutiveFailures} in a row): ${channel.lastError}. Helprr waits longer between tries until it works again.`
                    : channel.lastError}
                </span>
              </div>
            )}
            <div className="px-4 py-3 flex flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void sendTest(channel)}
                disabled={testingId !== null}
                className="w-full sm:flex-1 h-9"
              >
                {testingId === channel.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Send test
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditingId(channel.id)} className="w-full sm:flex-1 h-9">
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(channel)}
                className="w-full sm:flex-1 h-9 text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Remove
              </Button>
            </div>
          </GroupedSection>
        );
      })}

      {channels && (
        <GroupedSection
          title={adding ? 'New channel' : undefined}
          footer={adding ? 'Secrets are stored encrypted and never shown again after you save.' : undefined}
        >
          {adding ? (
            <ChannelForm
              availableEvents={availableEvents}
              submitLabel="Add channel"
              onSubmit={create}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <div className="px-4 py-3">
              <Button
                variant="outline"
                onClick={() => setAdding(true)}
                disabled={channels.length >= MAX_CHANNELS_PER_USER}
                className="w-full h-9"
              >
                <Plus className="mr-2 h-4 w-4" />
                {channels.length >= MAX_CHANNELS_PER_USER ? `Up to ${MAX_CHANNELS_PER_USER} channels` : 'Add channel'}
              </Button>
            </div>
          )}
        </GroupedSection>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}
        title={confirmDelete ? `Remove ${confirmDelete.name}?` : 'Remove channel?'}
        description="Helprr stops sending to it, and its saved settings and secrets are deleted."
        confirmLabel="Remove"
        destructive
        busy={deleting}
        onConfirm={() => (confirmDelete ? remove(confirmDelete) : Promise.resolve())}
      />
    </div>
  );
}
