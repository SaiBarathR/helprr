'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMe, hasCapability } from '@/components/permission-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { SwitchRow } from './setting-rows';
import { formatDuration, formatGb, type TwitchVideo } from './types';

const QUALITIES = [
  { id: '1440p60', label: '1440p', gbPerHour: 4.07 },
  { id: '1080p60', label: '1080p', gbPerHour: 3.46 },
  { id: '720p60', label: '720p', gbPerHour: 1.46 },
  { id: '480p', label: '480p', gbPerHour: 0.6 },
  { id: 'audio_only', label: 'Audio', gbPerHour: 0.094 },
] as const;

const OPTIONS = [
  { id: 'chat', label: 'Archive chat' },
  { id: 'chapters', label: 'Chapters from games' },
  { id: 'reencode', label: 'Re-encode tonight' },
  { id: 'keepForever', label: 'Keep forever' },
] as const;

interface VideoDetails {
  defaults: Defaults;
  canUse1440p: boolean;
}

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

function EstimateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grouped-row gap-3">
      <span className="text-sm">{label}</span>
      <span className="text-sm tabular-nums text-muted-foreground">{value}</span>
    </div>
  );
}

function SheetBody({ video, defaults, canUse1440p, onDone }: {
  video: TwitchVideo;
  defaults: Defaults;
  canUse1440p: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const canManage = hasCapability(useMe(), 'twitch.manage');
  const [quality, setQuality] = useState(defaults.quality);
  const [options, setOptions] = useState({
    chat: defaults.chat, chapters: defaults.chapters, reencode: defaults.reencode, keepForever: defaults.keepForever,
  });
  const [remember, setRemember] = useState(false);
  // One id per sheet, so a double tap or a retry cannot queue the video twice.
  const clientRequestId = useMemo(() => crypto.randomUUID(), []);

  const mutedSegments = video.mutedSegments ?? [];
  const mutedSeconds = mutedSegments.reduce((total, segment) => total + segment.duration, 0);
  const sizeGb = ((QUALITIES.find((item) => item.id === quality)?.gbPerHour ?? 3.46) * video.durationSeconds) / 3600;
  const fastestMinutes = Math.ceil((sizeGb * 1024) / 15 / 60);
  const slowestMinutes = Math.ceil((sizeGb * 1024) / 7 / 60);

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
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4">
        {mutedSeconds > 0 && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p>Twitch muted {formatDuration(mutedSeconds)} of the audio. It cannot be recovered.</p>
              <p className="mt-0.5 text-xs tabular-nums opacity-80">
                {mutedSegments.map((segment) => `${formatDuration(segment.offset)}–${formatDuration(segment.offset + segment.duration)}`).join(', ')}
              </p>
            </div>
          </div>
        )}
        <Tabs value={quality} onValueChange={setQuality}>
          <TabsList className="w-full" aria-label="Quality">
            {QUALITIES.filter((item) => canUse1440p || item.id !== '1440p60').map((item) => (
              <TabsTrigger key={item.id} value={item.id} className="flex-1">{item.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {quality === '1440p60' && <p className="px-1 text-xs text-muted-foreground">Twitch removes the 1440p copy after 7 days, so this falls back to 1080p on older videos.</p>}
        <div className="grouped-section-content overflow-hidden">
          {OPTIONS.map((item) => (
            <SwitchRow
              key={item.id}
              label={item.label}
              checked={options[item.id]}
              onCheckedChange={(checked) => setOptions((prev) => ({ ...prev, [item.id]: checked }))}
            />
          ))}
          {canManage && <SwitchRow label={`Remember for ${video.streamer.displayName}`} checked={remember} onCheckedChange={setRemember} />}
        </div>
        <div className="grouped-section-content overflow-hidden">
          <EstimateRow label="Length" value={formatDuration(video.durationSeconds)} />
          <EstimateRow label="Size" value={`≈ ${formatGb(sizeGb)}`} />
          <EstimateRow label="Time" value={fastestMinutes === slowestMinutes ? `≈ ${fastestMinutes} min` : `≈ ${fastestMinutes}–${slowestMinutes} min`} />
        </div>
      </div>
      <DrawerFooter>
        <Button className="w-full" disabled={queue.isPending} onClick={() => queue.mutate()}>
          {queue.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Download
        </Button>
      </DrawerFooter>
    </>
  );
}

export function DownloadSheet({ video, open, onOpenChange }: {
  video: TwitchVideo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const title = 'Download video';
  // The sheet starts from what the rules say for this video.
  const defaults = useQuery({
    queryKey: ['twitch', 'video', video.id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/twitch/videos/${video.id}`, { signal });
      if (!res.ok) throw new Error('Could not load the video');
      return (await res.json()) as VideoDetails;
    },
    enabled: open,
  });
  const body = defaults.data
    ? <SheetBody video={video} defaults={defaults.data.defaults} canUse1440p={defaults.data.canUse1440p} onDone={() => onOpenChange(false)} />
    : <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription className="line-clamp-2">{video.title}</DrawerDescription>
          </DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] max-w-md flex-col gap-3 p-0 pt-4">
        <DialogHeader className="px-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="line-clamp-2">{video.title}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
