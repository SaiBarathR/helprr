'use client';

import { Check } from 'lucide-react';
import type { MediaSourceInfo } from '@/types/jellyfin-playback';
import { formatTime } from '@/lib/playback/time';

/** A chapter mapped to seconds for the menu + seekbar tick marks. */
export interface ChapterMark {
  name?: string;
  seconds: number;
}

// Bitrate ladder for the quality menu (server picks resolution from the cap).
// null = no cap: direct play when the file qualifies.
const QUALITY_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'Auto (Direct)', value: null },
  { label: '80 Mbps', value: 80_000_000 },
  { label: '40 Mbps', value: 40_000_000 },
  { label: '20 Mbps', value: 20_000_000 },
  { label: '10 Mbps', value: 10_000_000 },
  { label: '6 Mbps', value: 6_000_000 },
  { label: '4 Mbps', value: 4_000_000 },
  { label: '3 Mbps', value: 3_000_000 },
  { label: '1.5 Mbps', value: 1_500_000 },
];

function MenuSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">
        {title}
      </p>
      <div role="group" aria-label={title}>
        {children}
      </div>
    </div>
  );
}

function MenuRow({
  label,
  detail,
  selected,
  onSelect,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/90 transition-colors hover:bg-white/10"
      aria-pressed={selected}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {selected && <Check className="h-4 w-4 text-primary" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail && <span className="shrink-0 text-xs text-white/40">{detail}</span>}
    </button>
  );
}

export function TrackMenus({
  open,
  onClose,
  source,
  audioStreamIndex,
  subtitleStreamIndex,
  maxBitrate,
  chapters,
  currentSeconds,
  autoplayNext,
  onSelectAudio,
  onSelectSubtitle,
  onSelectQuality,
  onSeekChapter,
  onToggleAutoplayNext,
}: {
  open: boolean;
  onClose: () => void;
  source: MediaSourceInfo | null;
  audioStreamIndex?: number;
  subtitleStreamIndex: number;
  maxBitrate: number | null;
  chapters: ChapterMark[];
  currentSeconds: number;
  /** undefined hides the autoplay toggle (movies). */
  autoplayNext?: boolean;
  onSelectAudio: (index: number) => void;
  onSelectSubtitle: (index: number) => void;
  onSelectQuality: (bitrate: number | null) => void;
  onSeekChapter: (seconds: number) => void;
  onToggleAutoplayNext?: () => void;
}) {
  if (!open || !source) return null;

  const audioStreams = source.MediaStreams.filter((s) => s.Type === 'Audio');
  const subtitleStreams = source.MediaStreams.filter(
    (s) => s.Type === 'Subtitle' && s.DeliveryMethod !== 'Drop'
  );

  return (
    <>
      {/* Backdrop: closes the menu without toggling the controls underneath */}
      <div className="absolute inset-0 z-30" onClick={onClose} aria-hidden />
      <div
        className="absolute bottom-20 right-3 z-40 max-h-[60dvh] w-72 overflow-y-auto rounded-xl border border-white/10 bg-black/90 pb-2 shadow-2xl backdrop-blur"
        role="menu"
        aria-label="Playback settings"
      >
        <MenuSection title="Quality">
          {QUALITY_OPTIONS.map((option) => (
            <MenuRow
              key={option.label}
              label={option.label}
              selected={maxBitrate === option.value}
              onSelect={() => {
                onSelectQuality(option.value);
                onClose();
              }}
            />
          ))}
        </MenuSection>

        {audioStreams.length > 1 && (
          <MenuSection title="Audio">
            {audioStreams.map((stream) => (
              <MenuRow
                key={stream.Index}
                label={stream.DisplayTitle ?? stream.Language ?? `Track ${stream.Index}`}
                selected={audioStreamIndex === stream.Index}
                onSelect={() => {
                  onSelectAudio(stream.Index);
                  onClose();
                }}
              />
            ))}
          </MenuSection>
        )}

        {subtitleStreams.length > 0 && (
          <MenuSection title="Subtitles">
            <MenuRow
              label="Off"
              selected={subtitleStreamIndex === -1}
              onSelect={() => {
                onSelectSubtitle(-1);
                onClose();
              }}
            />
            {subtitleStreams.map((stream) => (
              <MenuRow
                key={stream.Index}
                label={stream.DisplayTitle ?? stream.Language ?? `Subtitle ${stream.Index}`}
                detail={stream.DeliveryMethod === 'Encode' ? 'burned in' : undefined}
                selected={subtitleStreamIndex === stream.Index}
                onSelect={() => {
                  onSelectSubtitle(stream.Index);
                  onClose();
                }}
              />
            ))}
          </MenuSection>
        )}

        {chapters.length > 0 && (
          <MenuSection title="Chapters">
            {chapters.map((chapter, i) => (
              <MenuRow
                key={`${chapter.seconds}-${i}`}
                label={chapter.name ?? `Chapter ${i + 1}`}
                detail={formatTime(chapter.seconds)}
                selected={
                  currentSeconds >= chapter.seconds &&
                  (i === chapters.length - 1 || currentSeconds < chapters[i + 1].seconds)
                }
                onSelect={() => {
                  onSeekChapter(chapter.seconds);
                  onClose();
                }}
              />
            ))}
          </MenuSection>
        )}

        {onToggleAutoplayNext && (
          <MenuSection title="Playback">
            <MenuRow
              label="Autoplay next episode"
              selected={autoplayNext ?? false}
              onSelect={onToggleAutoplayNext}
            />
          </MenuSection>
        )}
      </div>
    </>
  );
}
