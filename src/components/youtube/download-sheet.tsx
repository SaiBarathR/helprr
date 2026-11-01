'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { SwitchRow } from '@/components/creators/setting-rows';
import { formatDuration, formatGb, type CreatorVideoItem } from '@/components/creators/types';
import { cn } from '@/lib/utils';

// Measured on the owner's channels, H.264 at 1080p, and scaled by pixels above and below that.
const QUALITIES = [
  { id: 'best', label: 'Best', gbPerHour: 6 },
  { id: '2160', label: '4K', gbPerHour: 4 },
  { id: '1440', label: '1440p', gbPerHour: 1.5 },
  { id: '1080', label: '1080p', gbPerHour: 0.5 },
  { id: '720', label: '720p', gbPerHour: 0.3 },
  { id: '480', label: '480p', gbPerHour: 0.15 },
] as const;

const CODECS = [
  { id: 'compatible', label: 'Most compatible (H.264)' },
  { id: 'av1', label: 'AV1, smallest' },
  { id: 'vp9', label: 'VP9' },
  { id: 'best', label: 'Best available' },
] as const;

const SPONSORBLOCK = [
  { id: 'mark', label: 'Mark as chapters' },
  { id: 'remove', label: 'Remove' },
  { id: 'off', label: 'Off' },
] as const;

function EstimateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grouped-row gap-3">
      <span className="text-sm">{label}</span>
      <span className="text-sm tabular-nums text-muted-foreground">{value}</span>
    </div>
  );
}

function ChoiceRow<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="grouped-row gap-3">
      <span className="text-sm">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="min-w-0 bg-transparent text-right text-base text-muted-foreground outline-none sm:text-sm"
      >
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}

function SheetBody({ video, onDone }: { video: CreatorVideoItem; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [quality, setQuality] = useState<(typeof QUALITIES)[number]['id']>('1080');
  const [codec, setCodec] = useState<(typeof CODECS)[number]['id']>('compatible');
  const [sponsorblock, setSponsorblock] = useState<(typeof SPONSORBLOCK)[number]['id']>('mark');
  const [keepForever, setKeepForever] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  // One id per sheet, so a double tap or a retry cannot queue the video twice.
  const clientRequestId = useMemo(() => crypto.randomUUID(), []);

  const sizeGb = ((QUALITIES.find((item) => item.id === quality)?.gbPerHour ?? 0.5) * video.durationSeconds) / 3600;
  const needsNewerCodec = codec === 'compatible' && ['best', '2160', '1440'].includes(quality);

  const queue = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/youtube/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: video.id, clientRequestId, options: { quality, codec, sponsorblock, keepForever } }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not queue the download');
    },
    onSuccess: () => {
      toast.success('Download queued');
      void queryClient.invalidateQueries({ queryKey: ['youtube'] });
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4">
        <Tabs value={quality} onValueChange={(next) => setQuality(next as typeof quality)}>
          <TabsList className="w-full" aria-label="Quality">
            {QUALITIES.map((item) => <TabsTrigger key={item.id} value={item.id} className="flex-1 px-1">{item.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        {needsNewerCodec && (
          <p className="px-1 text-xs text-muted-foreground">
            YouTube only offers H.264 up to 1080p, so this picks the best it has. Choose AV1 or VP9 under Advanced for higher quality.
          </p>
        )}
        <div className="grouped-section-content overflow-hidden">
          <EstimateRow label="Length" value={formatDuration(video.durationSeconds)} />
          <EstimateRow label="Size" value={`≈ ${formatGb(sizeGb)}`} />
        </div>
        <button
          type="button"
          aria-expanded={advanced}
          onClick={() => setAdvanced((open) => !open)}
          className="flex min-h-11 w-full items-center justify-between px-1 text-sm text-muted-foreground"
        >
          Advanced
          <ChevronDown className={cn('h-4 w-4 transition-transform', advanced && 'rotate-180')} />
        </button>
        {advanced && (
          <div className="grouped-section-content overflow-hidden">
            <ChoiceRow label="Codec" value={codec} options={CODECS} onChange={setCodec} />
            <ChoiceRow label="SponsorBlock" value={sponsorblock} options={SPONSORBLOCK} onChange={setSponsorblock} />
            <SwitchRow label="Keep forever" checked={keepForever} onCheckedChange={setKeepForever} />
          </div>
        )}
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

export function YoutubeDownloadSheet({ video, open, onOpenChange }: {
  video: CreatorVideoItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const title = 'Download video';
  const body = <SheetBody video={video} onDone={() => onOpenChange(false)} />;
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
