'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BellOff, ChevronLeft, Loader2, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { jsonFetcher, ApiError } from '@/lib/query-fetch';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { GroupedSection } from '@/components/settings/grouped-section';
import { usePushNotifications } from '@/hooks/use-push-notifications';

interface Device {
  id: string;
  endpoint: string;
  deviceName: string | null;
  consecutiveFailures: number;
  lastFailedAt: string | null;
  lastSucceededAt: string | null;
  createdAt: string;
}

function djb2Hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'unknown';
  }
}

function displayName(d: Device): string {
  if (d.deviceName && d.deviceName.trim()) return d.deviceName.trim();
  return `Device ${djb2Hash(d.endpoint)}`;
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

export default function NotificationDevicesPage() {
  const {
    subscriptionEndpoint,
    unsubscribe,
    loading: pushLoading,
  } = usePushNotifications();

  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<Device | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const {
    data: devices = null,
    isError,
    error: queryError,
  } = useQuery({
    queryKey: ['notifications', 'subscriptions'],
    queryFn: jsonFetcher<Device[]>('/api/notifications/subscriptions'),
  });
  const error = isError
    ? queryError instanceof ApiError
      ? `HTTP ${queryError.status}`
      : queryError instanceof Error
        ? queryError.message
        : 'Failed to load devices'
    : null;

  const load = () => queryClient.invalidateQueries({ queryKey: ['notifications', 'subscriptions'] });

  const isCurrent = (d: Device) => Boolean(subscriptionEndpoint && d.endpoint === subscriptionEndpoint);

  async function revokeRemote(id: string): Promise<boolean> {
    const res = await fetch('/api/notifications/subscriptions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    return res.ok;
  }

  async function revokeAllRemote(): Promise<{ ok: boolean; revoked: number }> {
    const res = await fetch('/api/notifications/subscriptions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    if (!res.ok) return { ok: false, revoked: 0 };
    const data = (await res.json().catch(() => ({}))) as { revoked?: number };
    return { ok: true, revoked: data.revoked ?? 0 };
  }

  async function handleRevokeOne(device: Device) {
    setRevoking(true);
    try {
      if (isCurrent(device)) {
        const result = await unsubscribe();
        if (!result.success) {
          toast.error(result.error || 'Failed to revoke this device');
          return;
        }
        toast.success('This device revoked');
      } else {
        const ok = await revokeRemote(device.id);
        if (!ok) {
          toast.error('Failed to revoke device');
          return;
        }
        toast.success(`Revoked ${displayName(device)}`);
      }
      await load();
    } finally {
      setRevoking(false);
      setConfirmTarget(null);
    }
  }

  async function handleRevokeAll() {
    setRevoking(true);
    try {
      const current = devices?.find(isCurrent) ?? null;
      const { ok, revoked } = await revokeAllRemote();
      if (!ok) {
        toast.error('Failed to revoke devices');
        return;
      }
      if (current) {
        try {
          await unsubscribe();
        } catch (err) {
          console.warn('local unsubscribe after revoke-all failed:', err);
        }
      }
      toast.success(revoked === 0 ? 'No active devices' : `Revoked ${revoked} device${revoked === 1 ? '' : 's'}`);
      await load();
    } finally {
      setRevoking(false);
      setConfirmAll(false);
    }
  }

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
        <h1 className="text-2xl font-semibold">Devices</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Devices currently subscribed to push notifications.
        </p>
      </div>

      {error && (
        <GroupedSection>
          <div className="px-4 py-3 text-sm text-red-400">{error}</div>
        </GroupedSection>
      )}

      {devices === null && !error ? (
        <GroupedSection>
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Loading devices…
          </div>
        </GroupedSection>
      ) : devices && devices.length === 0 ? (
        <GroupedSection>
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            <BellOff className="h-6 w-6 mx-auto mb-2 opacity-60" />
            No devices are subscribed.
          </div>
        </GroupedSection>
      ) : (
        devices?.map((d) => {
          const current = isCurrent(d);
          return (
            <GroupedSection
              key={d.id}
              title={current ? `${displayName(d)} · This device` : displayName(d)}
            >
              <div className="grouped-row">
                <span className="text-sm">Push endpoint</span>
                <span className="text-sm text-muted-foreground truncate max-w-[60%]">
                  {endpointHost(d.endpoint)}
                </span>
              </div>
              <div className="grouped-row">
                <span className="text-sm">Subscribed</span>
                <span className="text-sm text-muted-foreground">
                  {new Date(d.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="grouped-row">
                <span className="text-sm">Last delivery</span>
                <span className="text-sm text-muted-foreground">{relativeTime(d.lastSucceededAt)}</span>
              </div>
              <div className="grouped-row">
                <span className="text-sm">Last failure</span>
                <span className="text-sm text-muted-foreground">{relativeTime(d.lastFailedAt)}</span>
              </div>
              {d.consecutiveFailures > 0 && (
                <div className="grouped-row">
                  <span className="text-sm flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                    Consecutive failures
                  </span>
                  <span className="text-sm text-amber-400">{d.consecutiveFailures}</span>
                </div>
              )}
              <div className="px-4 py-3">
                <Button
                  variant="outline"
                  className="w-full h-9 text-destructive hover:text-destructive"
                  onClick={() => setConfirmTarget(d)}
                  disabled={revoking || (current && pushLoading)}
                >
                  <BellOff className="mr-2 h-4 w-4" />
                  Revoke {current ? 'this device' : 'device'}
                </Button>
              </div>
            </GroupedSection>
          );
        })
      )}

      {devices && devices.length > 0 && (
        <GroupedSection footer="Revoked devices stop receiving pushes and won't silently re-register">
          <div className="px-4 py-3">
            <Button
              variant="outline"
              className="w-full h-9 text-destructive hover:text-destructive"
              onClick={() => setConfirmAll(true)}
              disabled={revoking}
            >
              <Smartphone className="mr-2 h-4 w-4" />
              Revoke all devices
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
            ? `Revoke ${isCurrent(confirmTarget) ? 'this device' : displayName(confirmTarget)}?`
            : 'Revoke device?'
        }
        description={
          confirmTarget && isCurrent(confirmTarget)
            ? 'Push notifications will be disabled on this device. You can re-enable from this page anytime.'
            : 'Notifications stop immediately. The revoked device will need to re-enable from its own browser to start again.'
        }
        confirmLabel="Revoke"
        destructive
        busy={revoking}
        onConfirm={() => (confirmTarget ? handleRevokeOne(confirmTarget) : Promise.resolve())}
      />

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Revoke all devices?"
        description="Every subscribed device — including this one — will stop receiving pushes. Each device will need to re-enable from its own browser."
        confirmLabel="Revoke all"
        destructive
        busy={revoking}
        onConfirm={handleRevokeAll}
      />
    </div>
  );
}
