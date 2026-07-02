'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { GroupedSection } from '@/components/settings/grouped-section';
import { getQueryClient } from '@/lib/query-client';

export default function AccountSettingsPage() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        // Drop the in-memory TanStack cache so a different user signing in on this
        // device can't see this session's cached data (the QueryClient is a
        // persistent browser singleton). Login also clears, as a backstop.
        getQueryClient().clear();
        // Best-effort: drop this device's cached shell + read data so the next
        // sign-in starts clean. Fire-and-forget; don't block the redirect.
        const clearMsg = { type: 'helprr-clear-user-caches' };
        if (navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage(clearMsg);
        } else {
          // No controlling worker yet (e.g. after a hard reload / first load) —
          // reach any registered worker directly so the caches still get cleared.
          void navigator.serviceWorker
            ?.getRegistrations()
            .then((regs) => {
              for (const reg of regs) (reg.active ?? reg.installing)?.postMessage(clearMsg);
            })
            .catch(() => {});
        }
        router.push('/login');
      } else {
        toast.error('Failed to sign out');
        setSigningOut(false);
      }
    } catch {
      toast.error('Failed to sign out');
      setSigningOut(false);
    }
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
        <h1 className="text-2xl font-semibold">Account</h1>
      </div>

      <GroupedSection>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="grouped-row w-full text-left active:bg-foreground/5 transition-colors disabled:opacity-50"
        >
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
            <span className="text-sm font-medium text-red-500">
              {signingOut ? 'Signing out…' : 'Sign out'}
            </span>
          </div>
          {signingOut && <Loader2 className="h-4 w-4 animate-spin text-red-500" />}
        </button>
      </GroupedSection>
    </div>
  );
}
