'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, BellOff, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { usePushNotifications } from '@/hooks/use-push-notifications';

// App-wide nudge shown when push silently stops on a device that previously had
// it enabled (the common iOS case: the OS quietly drops the permission /
// subscription). Mounted once in the app shell so it surfaces on app open across
// every page — not just the notification settings screen.
export function PushReenableBanner() {
  const {
    subscribe,
    loading,
    wasReregistered,
    dismissReregisteredNotice,
    needsReenable,
    permissionDenied,
  } = usePushNotifications();
  const [dismissed, setDismissed] = useState(false);

  async function handleReenable() {
    const result = await subscribe();
    if (result.success) toast.success('Notifications re-enabled');
    else toast.error(result.error || 'Could not re-enable notifications');
  }

  if (wasReregistered) {
    return (
      <div className="mx-1 mb-2 flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-sm">
        <span className="text-amber-300">Notifications were re-registered for this device.</span>
        <Button variant="ghost" size="sm" onClick={dismissReregisteredNotice}>
          Dismiss
        </Button>
      </div>
    );
  }

  if (!needsReenable || dismissed) return null;

  return (
    <div className="mx-1 mb-2 flex items-start justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm">
      <div className="flex items-start gap-2.5 min-w-0">
        <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
        <div className="min-w-0">
          <div className="font-medium text-red-200">Notifications stopped on this device</div>
          {permissionDenied ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              Notifications are blocked. Re-allow them in your device or browser settings, then{' '}
              <Link href="/settings/notifications" className="text-primary underline">
                open notification settings
              </Link>{' '}
              to turn them back on.
            </div>
          ) : (
            <div className="mt-0.5 text-xs text-muted-foreground">
              Tap to start receiving downloads, imports, and alerts again.
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!permissionDenied && (
          <Button size="sm" onClick={handleReenable} disabled={loading} className="h-8">
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Bell className="mr-1.5 h-3.5 w-3.5" />}
            Re-enable
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
