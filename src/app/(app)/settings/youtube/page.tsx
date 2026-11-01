'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Circle } from 'lucide-react';
import { toast } from 'sonner';
import Link from '@/components/ui/app-link';
import { JellyfinLibrarySection } from '@/components/creators/jellyfin-library-section';
import { SwitchRow } from '@/components/creators/setting-rows';
import { GroupedSection } from '@/components/settings/grouped-section';
import { YoutubeConnectionCard } from '@/components/settings/youtube-connection-card';
import { ErrorState } from '@/components/ui/error-state';
import { cn } from '@/lib/utils';

interface Setup {
  apiKey: boolean;
  quota: { used: number; limit: number; searches: number; searchLimit: number };
  worker: { online: boolean; supportsYoutube: boolean };
  library: { mounted: boolean; jellyfinLibrary: boolean };
  account: boolean;
  cleanup: boolean;
}

function SetupRow({ label, done, detail, optional }: { label: string; done: boolean; detail: string; optional?: boolean }) {
  return (
    <div className="grouped-row grouped-row-stacked gap-0.5">
      <span className="flex items-center gap-2 text-sm">
        {done
          ? <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="min-w-0 flex-1">{label}</span>
        <span className={cn('shrink-0 text-xs', done ? 'text-emerald-400' : 'text-muted-foreground')}>
          {done ? 'Ready' : optional ? 'Optional' : 'Not ready'}
        </span>
      </span>
      {!done && <span className="pl-6 text-xs text-muted-foreground">{detail}</span>}
    </div>
  );
}

export default function YoutubeSettingsPage() {
  const queryClient = useQueryClient();
  const setup = useQuery({
    queryKey: ['youtube', 'setup'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/youtube/setup', { signal });
      if (!res.ok) throw new Error('Could not load YouTube setup');
      return (await res.json()) as Setup;
    },
    refetchInterval: 15_000,
  });
  const data = setup.data;

  const settings = useQuery({
    queryKey: ['youtube', 'settings'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/youtube/settings', { signal });
      if (!res.ok) throw new Error('Could not load the settings');
      return (await res.json()) as { autoDownloadEnabled: boolean };
    },
  });
  const toggle = useMutation({
    mutationFn: async (autoDownloadEnabled: boolean) => {
      const res = await fetch('/api/youtube/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoDownloadEnabled }),
      });
      if (!res.ok) throw new Error('Could not save');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['youtube', 'settings'] }),
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="animate-content-in">
      <div className="px-1 pb-2 pt-1">
        <Link href="/settings" className="-ml-1 inline-flex min-h-[44px] items-center gap-1 px-1 text-sm text-primary">
          <ChevronLeft className="h-5 w-5" />
          Settings
        </Link>
      </div>
      <div className="mb-4 px-4">
        <h1 className="text-2xl font-bold">YouTube</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Follow channels, and save videos to watch in Jellyfin.</p>
      </div>

      {setup.isError && <ErrorState message="Couldn't load YouTube setup" onRetry={() => void setup.refetch()} />}
      {data && (
        <GroupedSection title="Setup" footer={data.apiKey ? `Used today: ${data.quota.used.toLocaleString()} of ${data.quota.limit.toLocaleString()} API units, ${data.quota.searches} of ${data.quota.searchLimit} searches` : undefined}>
          <SetupRow label="API key" done={data.apiKey} detail="Add a free key below. Helprr uses it to find new videos." />
          <SetupRow
            label="Worker"
            done={data.worker.online && data.worker.supportsYoutube}
            detail={data.worker.online ? 'Update the worker to a version that supports YouTube.' : 'Start the worker: add youtube to COMPOSE_PROFILES, then run update.sh.'}
          />
          <SetupRow label="Library folder" done={data.library.mounted} detail="Set YOUTUBE_LIBRARY_HOST_PATH to a folder for these videos, then restart the worker." />
          <SetupRow label="Jellyfin library" done={data.library.jellyfinLibrary} detail="Create it below, so Jellyfin and your players can see the videos." />
          <Link href="/settings/youtube/account" className="block active:bg-foreground/5">
            <SetupRow label="Age-restricted videos" optional done={data.account} detail="Add a spare Google account to save these. Everything else works without one." />
          </Link>
          <SetupRow label="Automatic cleanup" optional done={data.cleanup} detail="Turn this on to clear videos a few days after you watch them." />
        </GroupedSection>
      )}
      <YoutubeConnectionCard defaultExpanded={data ? !data.apiKey : false} key={data ? String(data.apiKey) : 'loading'} />
      <JellyfinLibrarySection platform="youtube" defaultName="YouTube" />
      {settings.data && (
        <GroupedSection
          title="Automatic downloads"
          footer={settings.data.autoDownloadEnabled ? 'On: channels download by their rules' : 'Off: nothing downloads by itself, whatever the rules say'}
        >
          <SwitchRow
            label="Auto-download"
            checked={settings.data.autoDownloadEnabled}
            disabled={toggle.isPending}
            onCheckedChange={(autoDownloadEnabled) => toggle.mutate(autoDownloadEnabled)}
          />
          <Link href="/settings/youtube/rules" className="grouped-row gap-3 active:bg-foreground/5">
            <span className="text-sm">Global rules</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </GroupedSection>
      )}
    </div>
  );
}
