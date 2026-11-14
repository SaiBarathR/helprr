'use client';

import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { JellyfinConnectForm } from '@/components/settings/jellyfin-connect-form';

/**
 * What a Watch page shows a member whose profile has no Jellyfin account yet.
 *
 * The catalog answers `linked: false` for them, and the player's own Connect
 * form never appears because nothing can be opened to play. The link route
 * links the profile to the account these credentials prove they own (the same
 * form as Settings → Account), so the form sits right here, and connecting
 * reloads the page's catalog reads in place.
 */
export function JellyfinLinkPrompt() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return (
    <div className="mx-auto mt-8 w-full max-w-xs space-y-4">
      <div className="space-y-1.5 text-center">
        <p className="text-sm font-medium">Connect your Jellyfin account</p>
        <p className="text-xs text-muted-foreground">
          Sign in once to browse and play your library here. What you watch is recorded on your own account.
        </p>
      </div>
      <JellyfinConnectForm
        onConnected={(name) => {
          toast.success(`Connected as ${name}`);
          void queryClient.invalidateQueries({ queryKey: ['jellyfin'] });
          // Account settings and the player read "connected" from the profile.
          router.refresh();
        }}
      />
      <p className="text-center text-xs text-muted-foreground">
        Helprr never stores your Jellyfin password — only the access token the server returns.
      </p>
    </div>
  );
}
