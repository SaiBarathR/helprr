'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMe, hasCapability } from '@/components/permission-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Switch } from '@/components/ui/switch';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { cn } from '@/lib/utils';
import { formatDuration, type TwitchVideo } from './types';

const QUALITIES = [
  { id: '1080p60', label: '1080p60', gbPerHour: 3.46 },
  { id: '720p60', label: '720p60', gbPerHour: 1.46 },
  { id: '480p', label: '480p', gbPerHour: 0.6 },
  { id: 'audio_only', label: 'Audio', gbPerHour: 0.094 },
] as const;

const OPTIONS = [
  { id: 'chat', label: 'Archive chat' },
  { id: 'chapters', label: 'Chapters from games' },
  { id: 'reencode', label: 'Re-encode tonight' },
  { id: 'keepForever', label: 'Keep forever' },
] as const;

interface Defaults {
  quality: string;
  chat: boolean;
  chapters: boolean;
  reencode: boolean;
  keepForever: boolean;
}

// Merges into the streamer's rules, so its other settings and type rules survive.
async function rememberForStreamer(streamerId: string, choice: Defaults): Promise<void> {
  const res = await fetch(`/api/twitch/policies?streamerId=${streamerId}`);
  // Without the current rules, a save would replace them with just this choice.
  if (!res.ok) {
    toast.error('Queued, but the choice could not be remembered');
    return;
  }
  const stored = await res.json() as { streamer: { policy: object; typePolicies: object } | null };
  const saved = await fetch('/api/twitch/policies', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      streamerId,
      policy: { ...stored.streamer?.policy, ...choice },
      typePolicies: stored.streamer?.typePolicies ?? {},
    }),
  });
  if (!saved.ok) toast.error('Queued, but the choice could not be remembered');
}

function SheetBody({ video, defaults, onDone }: { video: TwitchVideo; defaults: Defaults; onDone: () => void }) {
  const queryClient = useQueryClient();
  const canManage = hasCapability(useMe(), 'twitch.manage');
  const [quality, setQuality] = useState(defaults.quality);
  const [options, setOptions] = useState({
    chat: defaults.chat, chapters: defaults.chapters, reencode: defaults.reencode, keepForever: defaults.keepForever,
  });
  const [remember, setRemember] = useState(false);
  // One id per sheet, so a double tap or a retry cannot queue the video twice.
  const clientRequestId = useMemo(() => crypto.randomUUID(), []);

  const mutedSeconds = (video.mutedSegments ?? []).reduce((total, segment) => total + segment.duration, 0);
  const sizeGb = ((QUALITIES.find((item) => item.id === quality)?.gbPerHour ?? 3.46) * video.durationSeconds) / 3600;

  const queue = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/twitch/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: video.id, clientRequestId, options: { quality, ...options } }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not queue the download');
      if (remember) await rememberForStreamer(video.streamer.id, { quality, ...options });
    },
    onSuccess: () => {
      toast.success('Download queued');
      void queryClient.invalidateQueries({ queryKey: ['twitch'] });
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="space-y-4 px-4 pb-4">
      <p className="line-clamp-2 text-sm text-muted-foreground">{video.title}</p>
      {mutedSeconds > 0 && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-300">
          Twitch muted {formatDuration(mutedSeconds)} of this audio. It cannot be recovered.
        </p>
      )}
      <div role="radiogroup" aria-label="Quality" className="grid grid-cols-4 gap-1 rounded-md bg-muted/40 p-1">
        {QUALITIES.map((item) => (
          <button
            key={item.id}
            role="radio"
            aria-checked={quality === item.id}
            onClick={() => setQuality(item.id)}
            className={cn('min-h-11 rounded text-sm font-medium', quality === item.id ? 'bg-background shadow-sm' : 'text-muted-foreground')}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="grouped-section-content">
        {OPTIONS.map((item) => (
          <label key={item.id} className="grouped-row min-h-11 w-full cursor-pointer">
            <span className="text-sm">{item.label}</span>
            <Switch
              checked={options[item.id]}
              onCheckedChange={(checked) => setOptions((prev) => ({ ...prev, [item.id]: checked }))}
            />
          </label>
        ))}
      </div>
      {canManage && (
        <label className="grouped-row min-h-11 w-full cursor-pointer rounded-lg bg-card">
          <span className="text-sm">Remember for {video.streamer.displayName}</span>
          <Switch checked={remember} onCheckedChange={setRemember} />
        </label>
      )}
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ['Length', formatDuration(video.durationSeconds)],
          ['Download', `≈ ${sizeGb < 1 ? `${Math.round(sizeGb * 1024)} MB` : `${sizeGb.toFixed(1)} GB`}`],
          ['After re-encode', options.reencode ? `≈ ${(sizeGb * 0.18).toFixed(1)}–${(sizeGb * 0.37).toFixed(1)} GB` : '—'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-card p-2">
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="font-mono text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      <Button className="h-11 w-full" disabled={queue.isPending} onClick={() => queue.mutate()}>
        {queue.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Download
      </Button>
    </div>
  );
}

export function DownloadSheet({ video, open, onOpenChange }: {
  video: TwitchVideo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const title = 'Download VOD';
  // The sheet starts from what the rules say for this video.
  const defaults = useQuery({
    queryKey: ['twitch', 'video', video.id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/twitch/videos/${video.id}`, { signal });
      if (!res.ok) throw new Error('Could not load the video');
      return (await res.json()) as { defaults: Defaults };
    },
    enabled: open,
  });
  const body = defaults.data
    ? <SheetBody video={video} defaults={defaults.data.defaults} onDone={() => onOpenChange(false)} />
    : <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>{title}</DrawerTitle></DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 pt-4">
        <DialogHeader className="px-4"><DialogTitle>{title}</DialogTitle></DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
