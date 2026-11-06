'use client';

import { useState } from 'react';
import Link from '@/components/ui/app-link';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { GroupedSection } from '@/components/settings/grouped-section';
import { JellyfinConnection } from '@/components/settings/jellyfin-connection';
import { ChangePasswordDrawer } from '@/components/settings/change-password-drawer';
import { useMe } from '@/components/permission-provider';
import { endSessionInThisBrowser, requestSessionLogout } from '@/lib/client-cache';

export default function AccountSettingsPage() {
  const me = useMe();
  const [signingOut, setSigningOut] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  async function handleSignOut() {
    setSigningOut(true);
    try {
      const logoutResult = await requestSessionLogout();
      if (logoutResult !== 'failed') {
        // A timeout or network error is indeterminate: the server may have
        // revoked the session before its response was lost. Treat it as an
        // authentication boundary and reconcile every browser realm.
        endSessionInThisBrowser();
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

      {me && (
        <GroupedSection>
          <div className="grouped-row gap-3">
            <div className="min-w-0">
              <div className="text-[15px] font-medium truncate">{me.name}</div>
              {me.username && (
                <div className="text-xs text-muted-foreground truncate">@{me.username}</div>
              )}
            </div>
            <span className="text-xs text-muted-foreground capitalize shrink-0">{me.role}</span>
          </div>
          {/* Jellyfin-only accounts have no Helprr password to change. */}
          {me.hasLocalPassword && (
            <button
              type="button"
              onClick={() => setChangingPassword(true)}
              className="grouped-row w-full text-left hover:bg-foreground/[0.03] active:bg-foreground/5 transition-colors"
            >
              <span className="text-sm font-medium">Change password</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </GroupedSection>
      )}

      {me?.hasLocalPassword && (
        <ChangePasswordDrawer
          open={changingPassword}
          onOpenChange={setChangingPassword}
          username={me.username ?? ''}
        />
      )}

      <JellyfinConnection />

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
