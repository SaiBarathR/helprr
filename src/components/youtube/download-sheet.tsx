'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { SwitchRow } from '@/components/creators/setting-rows';
import { formatDuration, type CreatorVideoItem } from '@/components/creators/types';
import type { DownloadOptions } from '@/lib/archive/jobs';
import { formatBytes } from '@/lib/format';
import {
  codecLabelOf, downloadOf, pickDownload, qualityLabel, resolutionLabel,
  type OfferedFormat, type PickedDownload, type VideoFormats, type YoutubeCodec,
} from '@/lib/youtube/formats';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'best', label: 'Best' },
  { id: '2160', label: '4K' },
  { id: '1440', label: '1440p' },
  { id: '1080', label: '1080p' },
  { id: '720', label: '720p' },
  { id: '480', label: '480p' },
] as const;

// What each codec is called in the rules.
const RULE_CODECS: Record<OfferedFormat['codec'], YoutubeCodec> = { h264: 'compatible', vp9: 'vp9', av1: 'av1' };
const WANTED_CODECS: Partial<Record<string, OfferedFormat['codec']>> = { compatible: 'h264', vp9: 'vp9', av1: 'av1' };

const SPONSORBLOCK = [
  { id: 'mark', label: 'Mark as chapters' },
  { id: 'remove', label: 'Remove' },
  { id: 'off', label: 'Off' },
] as const;

// The worker usually answers in about 3 seconds. Past this it may be off, so the sheet stops waiting.
const GIVE_UP_MS = 20_000;

// The Library's own format, so the two can be compared.
const sizeLabel = (bytes: number | null) => (bytes === null ? 'Not known' : formatBytes(bytes));

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grouped-row gap-3">
      <span className="shrink-0 text-sm">{label}</span>
      <span className="min-w-0 text-right text-sm tabular-nums text-muted-foreground">{value}</span>
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

/** Asks the worker what this video really offers. Nothing is shown until it answers or cannot. */
function useVideoFormats(videoId: string): { formats: VideoFormats | null; failed: boolean } {
  const asked = useRef(false);
  const [looked, setLooked] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const query = useQuery({
    queryKey: ['youtube', 'formats', videoId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/youtube/videos/${videoId}/formats`, { signal });
      if (!res.ok) throw new Error('Could not load the formats');
      return (await res.json()) as { formats: VideoFormats | null; pending: boolean };
    },
    refetchInterval: (state) => (state.state.data?.pending ? 1_000 : false),
    retry: false,
  });
  const { data, refetch, isError } = query;
  useEffect(() => {
    if (!data || data.formats || data.pending || asked.current) return;
    asked.current = true;
    void fetch(`/api/youtube/videos/${videoId}/formats`, { method: 'POST' })
      .then(() => refetch())
      .finally(() => setLooked(true));
  }, [data, videoId, refetch]);
  useEffect(() => {
    const timer = setTimeout(() => setGaveUp(true), GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, []);
  const formats = data?.formats?.offered.length ? data.formats : null;
  return { formats, failed: !formats && (isError || gaveUp || (looked && !data?.pending)) };
}

function CodecRows({ formats, picked, onPick }: {
  formats: VideoFormats;
  picked: PickedDownload;
  onPick: (format: OfferedFormat) => void;
}) {
  const rows = formats.offered.filter((format) => format.quality === picked.video.quality);
  return (
    <div role="radiogroup" aria-label="Codec" className="grouped-section-content overflow-hidden">
      {rows.map((format) => {
        const selected = format.id === picked.video.id;
        return (
          <button
            key={format.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onPick(format)}
            className="grouped-row w-full gap-3 text-left active:bg-foreground/5"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <Check className={cn('h-4 w-4 shrink-0 text-primary', !selected && 'invisible')} />
              {codecLabelOf(format)}
              {format.codec === 'h264' && <span className="truncate text-xs text-muted-foreground">Plays everywhere</span>}
            </span>
            <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{sizeLabel(downloadOf(formats, format).bytes)}</span>
          </button>
        );
      })}
    </div>
  );
}

function CheckingBody({ video }: { video: CreatorVideoItem }) {
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4" aria-busy>
      <Skeleton className="h-9 w-full rounded-lg" />
      <p role="status" className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking what this video offers
      </p>
      <div className="grouped-section-content overflow-hidden">
        <InfoRow label="Length" value={formatDuration(video.durationSeconds)} />
        <InfoRow label="Resolution" value={<Skeleton className="ml-auto h-4 w-28" />} />
        <InfoRow label="Size" value={<Skeleton className="ml-auto h-4 w-14" />} />
      </div>
      <Skeleton className="h-[132px] w-full rounded-xl" />
    </div>
  );
}

function SheetBody({ video, defaults, onDone }: { video: CreatorVideoItem; defaults: DownloadOptions; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { formats, failed } = useVideoFormats(video.id);
  const [quality, setQuality] = useState(defaults.quality);
  const [codec, setCodec] = useState(defaults.codec ?? 'compatible');
  const [hdr, setHdr] = useState(false);
  const [sponsorblock, setSponsorblock] = useState(defaults.sponsorblock ?? 'mark');
  const [keepForever, setKeepForever] = useState(defaults.keepForever);
  const [convert, setConvert] = useState(defaults.reencode);
  const [advanced, setAdvanced] = useState(false);
  // One id per sheet, so a double tap or a retry cannot queue the video twice.
  const clientRequestId = useMemo(() => crypto.randomUUID(), []);
  // The same decision the worker makes, and it is told which copy this landed on.
  const picked = formats && pickDownload(formats, quality, codec, hdr);

  const queue = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/youtube/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: video.id,
          clientRequestId,
          options: { quality, codec, hdr, formatId: picked?.video.id, sponsorblock, keepForever, reencode: convert },
        }),
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

  const checking = !formats && !failed;
  const tabs = formats ? TABS.filter(({ id }) => id === 'best' || formats.offered.some((format) => format.quality === Number(id))) : TABS;
  const landed = picked && quality !== 'best' ? String(picked.video.quality) : quality;
  const activeTab = tabs.some(({ id }) => id === landed) ? landed : 'best';
  const wanted = WANTED_CODECS[codec];
  const fellBack = picked && wanted && picked.video.codec !== wanted;

  return (
    <>
      {checking ? <CheckingBody video={video} /> : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4">
          <Tabs value={activeTab} onValueChange={setQuality}>
            <TabsList className="w-full" aria-label="Quality">
              {tabs.map((item) => <TabsTrigger key={item.id} value={item.id} className="flex-1 px-1">{item.label}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          {failed && (
            <p className="px-1 text-xs text-muted-foreground">
              Helprr could not check this video just now. It will save the closest quality to the one you pick, and the Queue will show which.
            </p>
          )}
          {fellBack && (
            <p className="px-1 text-xs text-muted-foreground">
              YouTube has no {codecLabelOf({ codec: wanted, hdr: false })} copy at {qualityLabel(picked.video.quality)}, so this uses {codecLabelOf(picked.video)}.
            </p>
          )}
          <div className="grouped-section-content overflow-hidden">
            <InfoRow label="Length" value={formatDuration(video.durationSeconds)} />
            {picked && <InfoRow label="Resolution" value={resolutionLabel(picked.video)} />}
            <InfoRow
              label="Size"
              value={`${picked?.bytes && sponsorblock === 'remove' ? 'Under ' : ''}${sizeLabel(picked?.bytes ?? null)}`}
            />
          </div>
          {picked && (
            <CodecRows
              formats={formats}
              picked={picked}
              onPick={(format) => {
                setCodec(RULE_CODECS[format.codec]);
                setHdr(format.hdr);
              }}
            />
          )}
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
              <ChoiceRow label="SponsorBlock" value={sponsorblock} options={SPONSORBLOCK} onChange={setSponsorblock} />
              <SwitchRow label="Re-encode to H.265 at night" checked={convert} onCheckedChange={setConvert} />
              <SwitchRow label="Keep forever" checked={keepForever} onCheckedChange={setKeepForever} />
            </div>
          )}
          {advanced && convert && (
            <p className="px-1 text-xs text-muted-foreground">YouTube files usually get bigger when re-encoded, because they are already small. Choose this only if a player needs H.265.</p>
          )}
        </div>
      )}
      <DrawerFooter>
        <Button className="w-full" disabled={checking || queue.isPending} onClick={() => queue.mutate()}>
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
  // The sheet starts from what the rules say for this video.
  const details = useQuery({
    queryKey: ['youtube', 'video', video.id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/youtube/videos/${video.id}`, { signal });
      if (!res.ok) throw new Error('Could not load the video');
      return (await res.json()) as CreatorVideoItem & { defaults: DownloadOptions };
    },
    enabled: open,
  });
  const defaults = details.data?.defaults;
  const body = defaults
    ? <SheetBody key={video.id} video={video} defaults={defaults} onDone={() => onOpenChange(false)} />
    : details.isError
      ? <ErrorState message="Couldn't load this video" onRetry={() => void details.refetch()} />
      : (
        <>
          <CheckingBody video={video} />
          <DrawerFooter><Button className="w-full" disabled>Download</Button></DrawerFooter>
        </>
      );
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
