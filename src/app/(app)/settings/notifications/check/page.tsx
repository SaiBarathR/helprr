'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, MinusCircle, Send, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import Link from '@/components/ui/app-link';
import { Button } from '@/components/ui/button';
import { GroupedSection } from '@/components/settings/grouped-section';
import { useMe } from '@/components/permission-provider';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { jsonFetcher } from '@/lib/query-fetch';
import { isIosDevice } from '@/lib/push-availability';
import { parseIosVersion, pushReadinessChecks, quietHoursFact, type PushCheck } from '@/lib/push-readiness';

// Facts about this browser that never change within a session.
const emptySubscribe = () => () => {};
const getSecure = () => window.isSecureContext;
const getOrigin = () => window.location.origin;
const getIos = () => isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
const getUserAgent = () => navigator.userAgent;
// Re-read on every render, so a grant or a block shows once the page re-renders.
const getPermission = (): NotificationPermission | null => ('Notification' in window ? Notification.permission : null);

const STATE_ICON: Record<PushCheck['state'], React.ReactNode> = {
  ok: <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" aria-hidden="true" />,
  fail: <XCircle className="h-5 w-5 text-red-400 shrink-0" aria-hidden="true" />,
  warn: <AlertTriangle className="h-5 w-5 text-orange-400 shrink-0" aria-hidden="true" />,
  checking: <Loader2 className="h-5 w-5 text-muted-foreground animate-spin shrink-0" aria-hidden="true" />,
  skip: <MinusCircle className="h-5 w-5 text-muted-foreground/60 shrink-0" aria-hidden="true" />,
};
const STATE_LABEL: Record<PushCheck['state'], string> = {
  ok: 'OK',
  fail: 'Needs fixing',
  warn: 'Worth a look',
  checking: 'Checking',
  skip: 'Not checked',
};

function CheckRow({ check }: { check: PushCheck }) {
  return (
    <li className="px-4 py-3 flex items-start gap-3">
      <span className="mt-0.5">{STATE_ICON[check.state]}</span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium">
          {check.title}
          <span className="sr-only">: {STATE_LABEL[check.state]}</span>
        </div>
        {check.detail && <div className="text-xs text-muted-foreground mt-0.5">{check.detail}</div>}
        {check.fixHref && check.state !== 'ok' && (
          <Link href={check.fixHref} className="inline-flex items-center gap-0.5 text-xs text-primary mt-1 min-h-[32px]">
            {check.fixHref.startsWith('/settings/appearance') ? 'How to install' : 'Open Notifications'}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>
    </li>
  );
}

export default function PushCheckPage() {
  const isAdmin = useMe()?.role === 'admin';
  const { isSupported, isSubscribed, isStandalone, loading, error: deviceError } = usePushNotifications();
  const secure = useSyncExternalStore(emptySubscribe, getSecure, () => true);
  const origin = useSyncExternalStore(emptySubscribe, getOrigin, () => '');
  const ios = useSyncExternalStore(emptySubscribe, getIos, () => false);
  const userAgent = useSyncExternalStore(emptySubscribe, getUserAgent, () => '');
  const permission = useSyncExternalStore(emptySubscribe, getPermission, () => null);

  const { data: serverPush, isError: serverError } = useQuery({
    queryKey: ['push', 'public-key'],
    queryFn: jsonFetcher<{ publicKey: string | null; configured?: boolean; missing?: string[] }>('/api/push/public-key'),
    staleTime: 60_000,
    // Offline, ask anyway: a paused query would leave the row "checking" for good.
    networkMode: 'always',
  });
  const serverConfigured = serverPush ? (serverPush.configured ?? Boolean(serverPush.publicKey)) : null;

  // Quiet hours skip pushes, so an all-green page could still say "No devices
  // received the test" with nothing here to tell why.
  const { data: mySettings } = useQuery({
    queryKey: ['me-settings'],
    queryFn: jsonFetcher<{
      quietHoursEnabled: boolean;
      quietHoursStart: number | null;
      quietHoursEnd: number | null;
      timeZone: string | null;
      serverTimeZone?: string | null;
    }>('/api/me/settings'),
  });

  // Is a service worker installed and running for this page? One that is still
  // installing (a first visit) gets ten seconds to become ready.
  const [workerActive, setWorkerActive] = useState<boolean | null>(null);
  useEffect(() => {
    if (!secure || !isSupported) return;
    let cancelled = false;
    const settle = (active: boolean) => {
      if (!cancelled) setWorkerActive(active);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    navigator.serviceWorker
      .getRegistration()
      .then((registration) => {
        if (registration?.active) return settle(true);
        // Installing, or not registered yet on a first visit (the app registers it as it starts).
        const timeout = new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 10_000);
        });
        return Promise.race([navigator.serviceWorker.ready.then(() => true), timeout]).then(settle);
      })
      .catch(() => settle(false));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [secure, isSupported]);

  const checks = pushReadinessChecks({
    secure,
    origin,
    supported: isSupported,
    ios,
    iosVersion: ios ? parseIosVersion(userAgent) : null,
    standalone: isStandalone,
    serverConfigured,
    serverUnreachable: serverError,
    serverMissing: serverPush?.missing,
    admin: isAdmin,
    workerActive,
    permission,
    subscribed: loading ? null : isSubscribed,
    deviceError,
    quietHours: quietHoursFact(mySettings, new Date()),
  });
  const failing = checks.filter((check) => check.state === 'fail').length;
  const worthALook = checks.filter((check) => check.state === 'warn').length;
  const checking = checks.some((check) => check.state === 'checking');
  const summary = checking
    ? 'Checking this device…'
    : failing > 0
      ? `${failing} ${failing === 1 ? 'thing stops' : 'things stop'} push on this device.`
      : worthALook > 0
        ? `Nothing found that stops push; ${worthALook} ${worthALook === 1 ? 'thing is' : 'things are'} worth a look.`
        : 'Push can reach this device.';

  const [testing, setTesting] = useState(false);
  async function sendTest() {
    setTesting(true);
    try {
      const res = await fetch('/api/notifications/test', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { sent?: number };
      const count = data.sent ?? 0;
      if (count > 0) toast.success(`Test sent to ${count} device${count === 1 ? '' : 's'}`);
      else toast.error('No devices received the test — check the logs.');
    } catch {
      toast.error('Test notification failed');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link href="/settings/notifications" className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          Notifications
        </Link>
      </div>

      <div className="px-4 mb-4">
        <h1 className="text-2xl font-semibold">Check push setup</h1>
        <p className="text-sm text-muted-foreground mt-1" role="status">{summary}</p>
      </div>

      <GroupedSection title="This device and server" className="mb-2">
        <ul className="divide-y divide-border/50">
          {checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </ul>
      </GroupedSection>
      {/* What a page cannot read for itself, aligned like a section footer. */}
      <div className="grouped-section mb-6">
        <p className="px-4 text-xs text-muted-foreground">
          Still nothing? Check this device&apos;s event types and quiet hours in{' '}
          <Link href="/settings/notifications" className="text-primary">Notifications</Link>, Focus or Do Not Disturb, the
          system&apos;s notification settings for this browser, and battery saver.
        </p>
      </div>

      {!loading && isSubscribed && (
        <GroupedSection footer="Sends to every device of yours that has push on">
          <div className="px-4 py-3">
            <Button variant="outline" size="sm" onClick={sendTest} disabled={testing} className="w-full h-9">
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-2 h-4 w-4" aria-hidden="true" />}
              Send a test notification
            </Button>
          </div>
        </GroupedSection>
      )}
    </div>
  );
}
