'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  Gauge,
  ListMusic,
  Maximize,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Repeat1,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Subtitles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  audioStreams,
  playMethodLabel,
  subtitleStreams,
  useJellyfinMediaRef,
  useJellyfinPlayback,
} from '@/components/jellyfin-streaming/playback-provider';
import { bitrateOptions } from '@/lib/jellyfin-playback/device-profile';
import { formatClock, ticksToSeconds } from '@/lib/jellyfin-playback/device';
import { jellyfinPosterUrl } from '@/lib/jellyfin-playback/image';
import { activeLyricIndex, normalizeJellyfinLyrics } from '@/lib/jellyfin-playback/lyrics';
import { FadeInImage } from '@/components/media/fade-in-image';
import { cn } from '@/lib/utils';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import type { LyricsResponse } from '@/types/jellyfin-streaming';
import { useUIStore } from '@/lib/store';
import {
  subtitleCueCss,
  type SubtitleAppearance,
  type SubtitleDropShadow,
  type SubtitleFont,
  type SubtitleTextSize,
} from '@/lib/jellyfin-playback/subtitle-appearance';
import {
  pickTrickplayResolution,
  trickplayMaxWidth,
  trickplayTileAt,
  type TrickplayTile,
} from '@/lib/jellyfin-playback/trickplay';

/** Player element class the ::cue rule is scoped to. */
const VIDEO_CLASS = 'hpr-jf-video';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable
    || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function VideoStage() {
  const playback = useJellyfinPlayback();
  const mediaRef = useJellyfinMediaRef();
  const [controlsVisible, setControlsVisible] = useState(true);
  const [panel, setPanel] = useState<'none' | 'audio' | 'subs' | 'quality' | 'speed' | 'chapters' | 'stats' | 'more'>('none');
  const isAudio = playback.item?.MediaType === 'Audio';
  const isActive = playback.status !== 'idle' && Boolean(playback.item);
  const isVideo = isActive && !isAudio;
  const expanded = playback.videoExpanded && isActive;

  // Re-opening the player should always start with the chrome up. Adjusting
  // state during render avoids the cascading re-render an effect would cause.
  const [chromeWasOpen, setChromeWasOpen] = useState(expanded);
  if (expanded !== chromeWasOpen) {
    setChromeWasOpen(expanded);
    if (expanded) setControlsVisible(true);
  }

  // Reading the live context through a ref keeps window listeners bound once
  // per open instead of re-binding on every timeupdate.
  const playbackRef = useRef(playback);
  useEffect(() => { playbackRef.current = playback; });

  // `pointermove` alone left touch users stranded: a stationary tap fires no
  // move event, so once the chrome auto-hid there was no way to get it back.
  // reveal() is therefore also wired to the surface tap below, and it re-arms
  // the hide timer itself so repeat activity keeps the chrome up.
  const hideTimerRef = useRef<number | null>(null);
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (playbackRef.current.status === 'playing') setControlsVisible(false);
    }, 3500);
  }, []);

  // Browser back used to leave the video fullscreen over whatever route it
  // landed on. Collapse to the mini player instead, so back reveals the page.
  useEffect(() => {
    const collapse = () => playbackRef.current.setVideoExpanded(false);
    window.addEventListener('popstate', collapse);
    return () => window.removeEventListener('popstate', collapse);
  }, []);

  useEffect(() => {
    if (!expanded) return undefined;
    // Arm the first hide without touching state — controlsVisible is reset to
    // true during render whenever the player opens (below).
    hideTimerRef.current = window.setTimeout(() => {
      if (playbackRef.current.status === 'playing') setControlsVisible(false);
    }, 3500);
    window.addEventListener('pointermove', revealControls);
    window.addEventListener('keydown', revealControls);
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      window.removeEventListener('pointermove', revealControls);
      window.removeEventListener('keydown', revealControls);
    };
  }, [expanded, revealControls]);

  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const p = playbackRef.current;
      if (!p.item) return;
      if (event.key === ' ' || event.key === 'k') { event.preventDefault(); p.togglePause(); }
      if (event.key === 'ArrowLeft' || event.key === 'j') p.skip(-10);
      if (event.key === 'ArrowRight' || event.key === 'l') p.skip(10);
      if (event.key === 'ArrowUp') { event.preventDefault(); p.setVolume(Math.min(1, p.volume + 0.05)); }
      if (event.key === 'ArrowDown') { event.preventDefault(); p.setVolume(Math.max(0, p.volume - 0.05)); }
      if (event.key === 'Escape') {
        p.setVideoExpanded(false);
        p.setQueueOpen(false);
      }
      if (event.key === 'm') p.setMuted(!p.muted);
      if (event.key === 'f') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.();
      }
      if (event.key === 'n') void p.next();
      if (event.key === 'p') void p.previous();
      if (event.key >= '0' && event.key <= '9' && p.durationSeconds > 0) {
        p.seek((Number(event.key) / 10) * p.durationSeconds);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  // Buffered range for the seek bar. Read from the element rather than the
  // context because the provider does not track it.
  const [bufferedSeconds, setBufferedSeconds] = useState(0);
  useEffect(() => {
    const el = mediaRef.current;
    if (!el || !expanded) return undefined;
    const read = () => {
      const ranges = el.buffered;
      setBufferedSeconds(ranges.length > 0 ? ranges.end(ranges.length - 1) : 0);
    };
    el.addEventListener('progress', read);
    el.addEventListener('timeupdate', read);
    return () => {
      el.removeEventListener('progress', read);
      el.removeEventListener('timeupdate', read);
    };
  }, [expanded, mediaRef]);

  const audios = audioStreams(playback.stream);
  const subs = subtitleStreams(playback.stream);
  const chapters = playback.item?.Chapters ?? playback.stream?.item.Chapters ?? [];
  const subtitleAppearance = useUIStore((state) => state.subtitleAppearance);
  const setSubtitleAppearance = useUIStore((state) => state.setSubtitleAppearance);
  const resetSubtitleAppearance = useUIStore((state) => state.resetSubtitleAppearance);
  const cueCss = useMemo(() => subtitleCueCss(subtitleAppearance, `.${VIDEO_CLASS}`), [subtitleAppearance]);

  const trickplayInfo = useMemo(
    () => pickTrickplayResolution(
      playback.stream?.item ?? playback.item,
      playback.stream?.mediaSource.Id,
      trickplayMaxWidth(),
    ),
    [playback.item, playback.stream],
  );
  const trickplayItemId = playback.stream?.item.Id;
  const trickplaySourceId = playback.stream?.mediaSource.Id;
  const trickplayAt = useCallback(
    (seconds: number) => (trickplayInfo && trickplayItemId
      ? trickplayTileAt(trickplayInfo, trickplayItemId, trickplaySourceId, seconds)
      : null),
    [trickplayInfo, trickplayItemId, trickplaySourceId],
  );

  // The selected text track decides whether appearance controls do anything:
  // libass renders ASS/SSA with the file's own styling, exactly as jellyfin-web
  // does, so ::cue never reaches it.
  const selectedSubFormat = playback.stream?.subtitleTracks
    .find((track) => track.index === playback.subtitleStreamIndex)?.format ?? '';
  const subtitleAppearanceApplies = selectedSubFormat !== 'ass' && selectedSubFormat !== 'ssa';
  const intro = useMemo(
    () => playback.segments.find((segment) => {
      const start = ticksToSeconds(segment.StartTicks);
      const end = ticksToSeconds(segment.EndTicks);
      const type = (segment.Type || '').toLowerCase();
      return (type.includes('intro') || type.includes('recap')) && playback.positionSeconds >= start && playback.positionSeconds < end - 1;
    }),
    [playback.positionSeconds, playback.segments],
  );
  const credits = useMemo(
    () => playback.segments.find((segment) => {
      const start = ticksToSeconds(segment.StartTicks);
      const type = (segment.Type || '').toLowerCase();
      return (type.includes('credit') || type.includes('outro')) && playback.positionSeconds >= start;
    }),
    [playback.positionSeconds, playback.segments],
  );

  const progress = playback.durationSeconds > 0 ? playback.positionSeconds / playback.durationSeconds : 0;
  const mini = isVideo && !expanded;
  const audioFull = isAudio && expanded;
  const video = playback.stream?.mediaSource.MediaStreams?.find((stream) => stream.Type === 'Video');
  const showChrome = expanded && (controlsVisible || panel !== 'none' || playback.status !== 'playing');

  // Lift the subtitles clear of the chrome while it is on screen. Cues render
  // at the bottom of the video by default, which is exactly where the scrubber,
  // the control row and the centred title now sit, so a line of dialogue lands
  // on top of them. The site raises its cues the same way.
  //
  // `line` is the only lever native ::cue rendering gives us — CSS cannot move
  // a cue box. Jellyfin's cues arrive with snapToLines false, which makes
  // `line` a percentage rather than a line count, so both have to be set. And
  // `cuechange` fires on the TextTrack, not on the media element.
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return undefined;
    const line: number | 'auto' = showChrome ? -4 : 'auto';
    const apply = () => {
      for (const track of Array.from(el.textTracks)) {
        if (track.mode === 'disabled') continue;
        const cues = Array.from(track.cues ?? []) as VTTCue[];
        // Every cue in a track gets the same treatment, so the first one is a
        // reliable signal that the track is already positioned.
        if (cues.length === 0 || cues[0].line === line) continue;
        for (const cue of cues) {
          cue.snapToLines = true;
          cue.line = line;
        }
      }
    };
    const tracks = el.textTracks;
    const listen = () => {
      for (const track of Array.from(tracks)) track.addEventListener('cuechange', apply);
    };
    apply();
    listen();
    tracks.addEventListener('addtrack', apply);
    tracks.addEventListener('addtrack', listen);
    return () => {
      tracks.removeEventListener('addtrack', apply);
      tracks.removeEventListener('addtrack', listen);
      for (const track of Array.from(tracks)) track.removeEventListener('cuechange', apply);
    };
  }, [showChrome, mediaRef, playback.subtitleStreamIndex])

  // Rendered inline on sm+ and inside the `more` panel below it, so there is
  // one definition of these controls rather than two.
  const secondaryControls = (
    <>
      <Button variant="ghost" size="icon" className="text-white" onClick={playback.toggleShuffle} aria-label="Shuffle" aria-pressed={playback.shuffled}>
        <Shuffle className={playback.shuffled ? 'text-[var(--hpr-amber)]' : undefined} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="text-white"
        onClick={() => playback.setRepeat(playback.repeat === 'RepeatNone' ? 'RepeatAll' : playback.repeat === 'RepeatAll' ? 'RepeatOne' : 'RepeatNone')}
        aria-label="Repeat"
      >
        {playback.repeat === 'RepeatOne' ? <Repeat1 className="text-[var(--hpr-amber)]" /> : <Repeat className={playback.repeat === 'RepeatAll' ? 'text-[var(--hpr-amber)]' : undefined} />}
      </Button>
      {audios.length > 1 && (
        <Button variant="ghost" size="sm" className="text-white" onClick={() => setPanel(panel === 'audio' ? 'none' : 'audio')}>Audio</Button>
      )}
      {chapters.length > 0 && (
        <Button variant="ghost" size="sm" className="text-white" onClick={() => setPanel(panel === 'chapters' ? 'none' : 'chapters')}>Chapters</Button>
      )}
      <Button variant="ghost" size="icon" className="text-white" onClick={() => setPanel(panel === 'quality' ? 'none' : 'quality')} aria-label="Quality">
        <Gauge />
      </Button>
      <Button variant="ghost" size="sm" className="text-white" onClick={() => setPanel(panel === 'speed' ? 'none' : 'speed')}>
        {playback.playbackRate}x
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="text-white"
        aria-label="Picture in picture"
        onClick={() => {
          const el = mediaRef.current;
          if (el && document.pictureInPictureElement) void document.exitPictureInPicture();
          else if (el) void el.requestPictureInPicture?.();
        }}
      >
        <PictureInPicture2 />
      </Button>
      <Button variant="ghost" size="sm" className="text-white" onClick={() => setPanel(panel === 'stats' ? 'none' : 'stats')}>Stats</Button>
      <Button variant="ghost" size="icon" className="text-white" onClick={() => void playback.stop()} aria-label="Stop">
        <X />
      </Button>
    </>
  );

  return (
    <>
      <div
        className={cn(
          'overflow-hidden bg-black',
          !isVideo && 'pointer-events-none fixed h-px w-px opacity-0',
          // Sits above the now-playing bar (62px) rather than on top of it —
          // at md:bottom-4 it used to cover Pause/Next/Repeat/Queue/Stop.
          mini && 'fixed right-3 bottom-[calc(9.5rem+env(safe-area-inset-bottom))] z-30 h-36 w-64 rounded-xl border shadow-2xl md:bottom-[5.5rem]',
          isVideo && expanded && 'fixed inset-0 z-[80]',
        )}
      >
        <div
          className={cn('relative h-full w-full', (mini || expanded) && 'cursor-pointer')}
          onClick={(event) => {
            if (mini) { playback.setVideoExpanded(true); return; }
            if (!expanded) return;
            // Controls handle their own clicks; only the bare surface toggles.
            if ((event.target as HTMLElement | null)?.closest('button, a, input, select, label')) return;
            if (controlsVisible) playback.togglePause();
            else revealControls();
          }}
        >
          <style>{cueCss}</style>
          <video
            ref={mediaRef}
            className={cn('h-full w-full bg-black object-contain', VIDEO_CLASS)}
            playsInline
            preload="metadata"
          />

            {playback.status === 'loading' && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Loading stream…</div>
            )}
            {playback.error && (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-300">{playback.error}</div>
            )}

            {intro && expanded && (
              <Button className="absolute right-4 bottom-36 z-10" onClick={() => playback.skipSegment(intro)}>
                Skip {intro.Type}
              </Button>
            )}
            {credits && expanded && (
              <Button variant="secondary" className="absolute right-4 bottom-36 z-10" onClick={() => void playback.next()}>
                Next episode
              </Button>
            )}

            {showChrome && (
              <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/80 via-black/20 to-black/50">
                {/* The site keeps a single control in the top-left of its
                    player and nothing else up there. Ours is Minimize rather
                    than its Back, so it keeps the chevron that says so — but it
                    sits in the same corner, and the title moved down into the
                    control row. A phone has no room for a centred title there,
                    so it stays up here beside the button. */}
                <div className="flex items-start gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4 md:px-8">
                  <Button variant="ghost" size="icon" className="shrink-0 text-white" onClick={() => playback.setVideoExpanded(false)} aria-label="Minimize player">
                    <ChevronDown />
                  </Button>
                  <div className="min-w-0 md:hidden">
                    <p className="truncate text-lg font-semibold text-white">{playback.item?.Name}</p>
                    <p className="truncate text-xs text-white/70">
                      {playback.item?.SeriesName
                        ? `${playback.item.SeriesName} · S${playback.item.ParentIndexNumber ?? 0}E${playback.item.IndexNumber ?? 0}`
                        : playback.item?.ProductionYear}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-8">
                  {/* Panels sit above the scrubber, which is the top row. */}
                  {panel === 'more' && (
                    <Panel>
                      <div className="flex flex-wrap items-center gap-1">{secondaryControls}</div>
                    </Panel>
                  )}
                  {panel === 'audio' && (
                    <Panel>
                      {audios.map((stream) => (
                        <PanelButton
                          key={stream.Index}
                          active={stream.Index === playback.audioStreamIndex}
                          onClick={() => void playback.setAudioStream(stream.Index ?? -1)}
                        >
                          {stream.DisplayTitle || stream.Language || `Audio ${stream.Index}`}
                        </PanelButton>
                      ))}
                    </Panel>
                  )}
                  {panel === 'subs' && (
                    <Panel>
                      <PanelButton active={playback.subtitleStreamIndex == null || playback.subtitleStreamIndex < 0} onClick={() => void playback.setSubtitleStream(-1)}>Off</PanelButton>
                      {subs.map((stream) => (
                        <PanelButton
                          key={stream.Index}
                          active={stream.Index === playback.subtitleStreamIndex}
                          onClick={() => void playback.setSubtitleStream(stream.Index ?? -1)}
                        >
                          {stream.DisplayTitle || stream.Language || `Subtitle ${stream.Index}`}
                        </PanelButton>
                      ))}
                      <div className="mt-2 flex items-center justify-between gap-2 px-2 py-1 text-xs text-white/80">
                        <span>Delay {playback.subtitleOffsetSeconds.toFixed(1)}s</span>
                        <span className="flex gap-1">
                          <button type="button" className="rounded bg-white/10 px-2 py-1" onClick={() => playback.setSubtitleOffset(playback.subtitleOffsetSeconds - 0.5)}>-0.5</button>
                          <button type="button" className="rounded bg-white/10 px-2 py-1" onClick={() => playback.setSubtitleOffset(0)}>Reset</button>
                          <button type="button" className="rounded bg-white/10 px-2 py-1" onClick={() => playback.setSubtitleOffset(playback.subtitleOffsetSeconds + 0.5)}>+0.5</button>
                        </span>
                      </div>
                      <SubtitleAppearanceControls
                        appearance={subtitleAppearance}
                        onChange={setSubtitleAppearance}
                        onReset={resetSubtitleAppearance}
                        disabled={!subtitleAppearanceApplies}
                      />
                    </Panel>
                  )}
                  {panel === 'chapters' && (
                    <Panel>
                      {chapters.map((chapter, chapterIndex) => (
                        <PanelButton
                          key={`${chapter.StartPositionTicks}-${chapterIndex}`}
                          active={false}
                          onClick={() => playback.seek(ticksToSeconds(chapter.StartPositionTicks))}
                        >
                          {chapter.Name || `Chapter ${chapterIndex + 1}`} · {formatClock(ticksToSeconds(chapter.StartPositionTicks))}
                        </PanelButton>
                      ))}
                    </Panel>
                  )}
                  {panel === 'quality' && (
                    <Panel>
                      {bitrateOptions().map((option) => (
                        <PanelButton
                          key={option.value}
                          active={(option.value === 0 && playback.maxBitrate === 0) || option.value === playback.maxBitrate}
                          onClick={() => void playback.setMaxBitrate(option.value)}
                        >
                          {option.label}
                        </PanelButton>
                      ))}
                    </Panel>
                  )}
                  {panel === 'speed' && (
                    <Panel>
                      {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                        <PanelButton key={rate} active={playback.playbackRate === rate} onClick={() => playback.setPlaybackRate(rate)}>
                          {rate}x
                        </PanelButton>
                      ))}
                    </Panel>
                  )}
                  {panel === 'stats' && playback.stream && (
                    <Panel>
                      <p className="px-3 py-2 text-xs text-white/80">
                        {playMethodLabel(playback.stream.playMethod)}
                        {video ? ` · ${video.Codec?.toUpperCase()} ${video.Width}×${video.Height}` : ''}
                        {playback.stream.mediaSource.Container ? ` · ${playback.stream.mediaSource.Container}` : ''}
                        {playback.stream.mediaSource.Bitrate ? ` · ${Math.round(playback.stream.mediaSource.Bitrate / 1000)} kbps` : ''}
                      </p>
                    </Panel>
                  )}
                  {/* Reference order: the bar first, then the controls beneath
                      it. The site puts its scrubber above the control row with
                      the clock at the bar's end; ours used to sit under the
                      controls with the times on a third row of their own.
                      The site shows remaining only — elapsed is kept here
                      because dropping a readout is a loss, not a restyle. */}
                  <div className="flex items-center gap-3 pb-1 text-[11px] tabular-nums text-white/70 md:pb-8">
                    <span>{formatClock(playback.positionSeconds)}</span>
                    <div className="min-w-0 flex-1">
                      <SeekBar
                        positionSeconds={playback.positionSeconds}
                        durationSeconds={playback.durationSeconds}
                        bufferedSeconds={bufferedSeconds}
                        chapters={chapters}
                        onSeek={playback.seek}
                        trickplayAt={trickplayAt}
                      />
                    </div>
                    <span>
                      {playback.durationSeconds > 0
                        ? `-${formatClock(Math.max(0, playback.durationSeconds - playback.positionSeconds))}`
                        : formatClock(playback.durationSeconds)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="text-white" onClick={() => playback.skip(-10)} aria-label="Back 10 seconds">
                        <SkipBack />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-lg"
                        className="text-white"
                        onClick={playback.togglePause}
                        aria-label={playback.status === 'paused' ? 'Play' : 'Pause'}
                      >
                        {playback.status === 'paused'
                          ? <Play className="size-7 fill-current" />
                          : <Pause className="size-7 fill-current" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="text-white" onClick={() => playback.skip(10)} aria-label="Forward 10 seconds">
                        <SkipForward />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-white" onClick={() => playback.setMuted(!playback.muted)} aria-label={playback.muted ? 'Unmute' : 'Mute'}>
                        {playback.muted || playback.volume === 0 ? <VolumeX /> : <Volume2 />}
                      </Button>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={playback.muted ? 0 : playback.volume}
                        aria-label="Volume"
                        className="hidden w-20 accent-[var(--hpr-amber)] sm:block"
                        onChange={(event) => {
                          playback.setMuted(false);
                          playback.setVolume(Number(event.target.value));
                        }}
                      />
                    </div>
                    {/* The site centres the title in its control row rather than
                        parking it in a top corner. Desktop only: on a phone the
                        two clusters already fill the row, so the top bar keeps
                        the title there instead. */}
                    <p className="hidden min-w-0 flex-1 truncate px-4 text-center text-sm text-white/90 md:block">
                      {playback.item?.SeriesName ? (
                        <>
                          <span className="font-semibold">{playback.item.SeriesName}</span>
                          <span className="text-white/60">
                            {` S${playback.item.ParentIndexNumber ?? 0}E${playback.item.IndexNumber ?? 0} `}
                          </span>
                          {playback.item.Name}
                        </>
                      ) : (
                        <span className="font-semibold">{playback.item?.Name}</span>
                      )}
                    </p>
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="text-white" onClick={() => setPanel(panel === 'subs' ? 'none' : 'subs')} aria-label="Subtitles">
                        <Subtitles />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-white" onClick={() => playback.setQueueOpen(!playback.queueOpen)} aria-label="Queue">
                        <ListMusic />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-white"
                        aria-label="Fullscreen"
                        onClick={() => {
                          const root = document.documentElement;
                          if (document.fullscreenElement) void document.exitFullscreen();
                          else void root.requestFullscreen?.();
                        }}
                      >
                        <Maximize />
                      </Button>
                      {/* Everything low-frequency lives behind one gear, on every
                          breakpoint — twelve inline controls was a debug toolbar. */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-white"
                        aria-label="Player settings"
                        aria-expanded={panel === 'more'}
                        onClick={() => setPanel(panel === 'more' ? 'none' : 'more')}
                      >
                        <Settings />
                      </Button>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {mini && (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/70 p-1">
                <Button variant="ghost" size="icon-xs" className="text-white" onClick={(event) => { event.stopPropagation(); playback.togglePause(); }}>
                  {playback.status === 'paused' ? <Play className="fill-current" /> : <Pause className="fill-current" />}
                </Button>
                <div className="h-0.5 flex-1 rounded bg-white/20">
                  <div className="h-full rounded bg-[var(--hpr-seek)]" style={{ width: `${progress * 100}%` }} />
                </div>
                <Button variant="ghost" size="icon-xs" className="text-white" onClick={(event) => { event.stopPropagation(); void playback.stop(); }}>
                  <X />
                </Button>
              </div>
            )}
          </div>
        </div>

      {audioFull && playback.item && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-background">
          <div className="flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <Button variant="ghost" size="icon" onClick={() => playback.setVideoExpanded(false)} aria-label="Minimize">
              <ChevronDown />
            </Button>
            <p className="text-sm text-muted-foreground">Now playing</p>
            <Button variant="ghost" size="icon" onClick={() => void playback.stop()} aria-label="Stop">
              <X />
            </Button>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
            <div className="relative aspect-square w-64 overflow-hidden rounded-2xl bg-muted shadow-xl sm:w-80">
              {jellyfinPosterUrl(playback.item, 600) && (
                <FadeInImage src={jellyfinPosterUrl(playback.item, 600)!} alt="" fill sizes="320px" unoptimized className="object-cover" />
              )}
            </div>
            <div className="w-full max-w-md text-center">
              <p className="text-xl font-semibold">{playback.item.Name}</p>
              <p className="text-sm text-muted-foreground">{playback.item.Artists?.join(', ') || playback.item.AlbumArtist}</p>
            </div>
            <div className="w-full max-w-md space-y-2">
              <SeekBar
                bare
                positionSeconds={playback.positionSeconds}
                durationSeconds={playback.durationSeconds}
                onSeek={playback.seek}
              />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>{formatClock(playback.positionSeconds)}</span>
                <span>{formatClock(playback.durationSeconds)}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={playback.toggleShuffle} aria-pressed={playback.shuffled}>
                <Shuffle className={playback.shuffled ? 'text-[var(--hpr-amber)]' : undefined} />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => void playback.previous()}><SkipBack /></Button>
              <Button size="icon-lg" onClick={playback.togglePause}>
                {playback.status === 'paused' ? <Play className="fill-current" /> : <Pause />}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => void playback.next()}><SkipForward /></Button>
              <Button variant="ghost" size="icon" onClick={() => playback.setQueueOpen(true)}><ListMusic /></Button>
            </div>
            <AudioLyrics itemId={playback.item.Id} positionSeconds={playback.positionSeconds} />
          </div>
        </div>
      )}

      {playback.queueOpen && (
        <div className="app-glass-overlay fixed inset-y-0 right-0 z-[90] flex w-full max-w-sm flex-col border-l bg-background shadow-2xl">
          <div className="flex items-center justify-between border-b p-3">
            <p className="text-sm font-semibold">Queue · {playback.queue.length}</p>
            <Button variant="ghost" size="icon-sm" onClick={() => playback.setQueueOpen(false)} aria-label="Close queue">
              <X />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {playback.queue.map((queued, queuedIndex) => (
              <button
                key={`${queued.Id}-${queuedIndex}`}
                type="button"
                onClick={() => void playback.playQueueIndex(queuedIndex)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent',
                  queuedIndex === playback.index && 'bg-accent',
                )}
              >
                <span className="w-6 text-xs text-muted-foreground">{queuedIndex + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{queued.Name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function AudioLyrics({ itemId, positionSeconds }: { itemId: string; positionSeconds: number }) {
  const query = useQuery({
    queryKey: queryKeys.jellyfinLyrics(itemId),
    queryFn: jsonFetcher<LyricsResponse>(`/api/jellyfin/catalog/lyrics?itemId=${encodeURIComponent(itemId)}`),
  });
  const lines = useMemo(() => normalizeJellyfinLyrics(query.data?.lyrics), [query.data?.lyrics]);
  const active = activeLyricIndex(lines, positionSeconds);
  if (lines.length === 0) return null;
  return (
    <div className="max-h-48 w-full max-w-md overflow-y-auto text-center">
      {lines.map((line, index) => (
        <p
          key={`${line.text}-${index}`}
          className={cn(
            'py-0.5 text-sm transition-colors',
            index === active ? 'font-semibold text-foreground' : 'text-muted-foreground',
          )}
        >
          {line.text}
        </p>
      ))}
    </div>
  );
}

/**
 * Seek bar that previews while you drag and commits once on release.
 *
 * Binding `value` straight to the live position made the thumb fight playback
 * mid-drag, and because React maps range `onChange` to the `input` event, every
 * intermediate value used to call `seek()` — which on a non-HLS transcode is a
 * full stopEncodings + PlaybackInfo + restart cycle per drag step.
 */
function SeekBar({
  positionSeconds,
  durationSeconds,
  onSeek,
  trickplayAt,
  bufferedSeconds = 0,
  chapters = [],
  bare = false,
}: {
  positionSeconds: number;
  durationSeconds: number;
  onSeek: (seconds: number) => void;
  trickplayAt?: (seconds: number) => TrickplayTile | null;
  bufferedSeconds?: number;
  chapters?: Array<{ Name?: string; StartPositionTicks?: number }>;
  /** Audio player uses the plain native control; video draws its own track. */
  bare?: boolean;
}) {
  const [dragSeconds, setDragSeconds] = useState<number | null>(null);
  const [previewSeconds, setPreviewSeconds] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const max = durationSeconds > 0 ? durationSeconds : 1;
  const value = Math.min(dragSeconds ?? positionSeconds, max);

  const commit = useCallback(() => {
    const pending = dragRef.current;
    dragRef.current = null;
    setDragSeconds(null);
    setPreviewSeconds(null);
    if (pending != null) onSeek(pending);
  }, [onSeek]);

  useEffect(() => {
    if (dragSeconds == null) return undefined;
    // The pointer can be released outside the input; still commit.
    window.addEventListener('pointerup', commit);
    window.addEventListener('pointercancel', commit);
    return () => {
      window.removeEventListener('pointerup', commit);
      window.removeEventListener('pointercancel', commit);
    };
  }, [commit, dragSeconds]);

  const hoverPreview = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!trickplayAt || dragRef.current != null || event.pointerType === 'touch') return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setPreviewSeconds(fraction * max);
  };

  const bubbleSeconds = dragSeconds ?? previewSeconds;
  const tile = trickplayAt && bubbleSeconds != null ? trickplayAt(bubbleSeconds) : null;

  return (
    <div
      className="relative"
      onPointerMove={hoverPreview}
      onPointerLeave={() => { if (dragRef.current == null) setPreviewSeconds(null); }}
    >
      {bubbleSeconds != null && (tile || dragSeconds != null) && (
        <div
          className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2"
          style={{ left: `${Math.min(92, Math.max(8, (bubbleSeconds / max) * 100))}%` }}
        >
          {tile && (
            <div
              className="overflow-hidden rounded border border-white/20 bg-black shadow-lg"
              style={{
                width: tile.width,
                height: tile.height,
                backgroundImage: `url('${tile.url}')`,
                backgroundPositionX: `${tile.offsetX}px`,
                backgroundPositionY: `${tile.offsetY}px`,
              }}
            />
          )}
          <p className="mt-1 rounded bg-black/80 px-1.5 py-0.5 text-center text-[11px] tabular-nums text-white">
            {formatClock(bubbleSeconds)}
          </p>
        </div>
      )}
      <span className={cn('relative block', bare ? '' : 'h-4')}>
        {!bare && (
          <>
            <span className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
              <span
                className="absolute inset-y-0 left-0 bg-white/40"
                style={{ width: `${Math.min(100, (bufferedSeconds / max) * 100)}%` }}
              />
              <span
                className="absolute inset-y-0 left-0 bg-[var(--hpr-seek)]"
                style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
              />
            </span>
            {chapters.map((chapter, chapterIndex) => {
              const at = ticksToSeconds(chapter.StartPositionTicks);
              if (at <= 0 || at >= max) return null;
              return (
                <span
                  key={`${chapter.StartPositionTicks}-${chapterIndex}`}
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 h-2 w-px -translate-y-1/2 bg-white/70"
                  style={{ left: `${(at / max) * 100}%` }}
                />
              );
            })}
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--hpr-seek)] shadow"
              style={{ left: `${Math.min(100, (value / max) * 100)}%` }}
            />
          </>
        )}
        <input
          type="range"
          min={0}
          max={max}
          step={0.1}
          value={value}
          aria-label="Seek"
          aria-valuetext={formatClock(value)}
          className={cn(
            'w-full',
            bare
              ? 'accent-[var(--hpr-seek)]'
              : 'absolute inset-0 h-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-transparent',
          )}
          onChange={(event) => {
            const next = Number(event.target.value);
            dragRef.current = next;
            setDragSeconds(next);
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
      </span>
    </div>
  );
}

const TEXT_SIZES: Array<{ value: SubtitleTextSize; label: string }> = [
  { value: 'smaller', label: 'Smaller' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'larger', label: 'Larger' },
  { value: 'extralarge', label: 'Extra large' },
];

const SUBTITLE_FONTS: Array<{ value: SubtitleFont; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'typewriter', label: 'Typewriter' },
  { value: 'print', label: 'Print' },
  { value: 'console', label: 'Console' },
  { value: 'cursive', label: 'Cursive' },
  { value: 'casual', label: 'Casual' },
  { value: 'smallcaps', label: 'Small caps' },
];

const DROP_SHADOWS: Array<{ value: SubtitleDropShadow; label: string }> = [
  { value: 'dropshadow', label: 'Drop shadow' },
  { value: 'raised', label: 'Raised' },
  { value: 'depressed', label: 'Depressed' },
  { value: 'uniform', label: 'Uniform' },
  { value: 'none', label: 'None' },
];

const TEXT_COLORS = ['#ffffff', '#ffff00', '#00ff00', '#00ffff', '#ff9900', '#000000'];
const TEXT_BACKGROUNDS: Array<{ value: string; label: string }> = [
  { value: 'transparent', label: 'None' },
  { value: 'rgba(0,0,0,0.5)', label: 'Dim' },
  { value: '#000000', label: 'Solid' },
];

/**
 * Mirrors jellyfin-web's subtitle appearance settings. Disabled for ASS/SSA,
 * where libass owns the styling and ::cue is never consulted.
 */
function SubtitleAppearanceControls({
  appearance,
  onChange,
  onReset,
  disabled,
}: {
  appearance: SubtitleAppearance;
  onChange: (patch: Partial<SubtitleAppearance>) => void;
  onReset: () => void;
  disabled: boolean;
}) {
  const selectClass = 'rounded bg-white/10 px-1.5 py-1 text-xs text-white disabled:opacity-40 [&>option]:text-black';
  return (
    <div className="mt-2 space-y-1.5 border-t border-white/10 px-2 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-white/80">Appearance</span>
        <button type="button" className="rounded bg-white/10 px-2 py-0.5 text-[11px] text-white disabled:opacity-40" onClick={onReset} disabled={disabled}>
          Reset
        </button>
      </div>
      {disabled && (
        <p className="text-[11px] text-white/50">
          This track is ASS/SSA — libass renders its built-in styling, same as Jellyfin Web.
        </p>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex flex-col gap-0.5 text-[11px] text-white/60">
          Size
          <select className={selectClass} value={appearance.textSize} disabled={disabled} onChange={(e) => onChange({ textSize: e.target.value as SubtitleTextSize })}>
            {TEXT_SIZES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-white/60">
          Font
          <select className={selectClass} value={appearance.font} disabled={disabled} onChange={(e) => onChange({ font: e.target.value as SubtitleFont })}>
            {SUBTITLE_FONTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-white/60">
          Edge
          <select className={selectClass} value={appearance.dropShadow} disabled={disabled} onChange={(e) => onChange({ dropShadow: e.target.value as SubtitleDropShadow })}>
            {DROP_SHADOWS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-white/60">
          Background
          <select className={selectClass} value={appearance.textBackground} disabled={disabled} onChange={(e) => onChange({ textBackground: e.target.value })}>
            {TEXT_BACKGROUNDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-white/60">Colour</span>
        <span className="flex gap-1">
          {TEXT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Subtitle colour ${color}`}
              aria-pressed={appearance.textColor === color}
              disabled={disabled}
              onClick={() => onChange({ textColor: color })}
              className={cn(
                'size-5 rounded border disabled:opacity-40',
                appearance.textColor === color ? 'border-[var(--hpr-amber)]' : 'border-white/30',
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-white/60">Position {appearance.verticalPosition}</span>
        <span className="flex gap-1">
          <button type="button" className="rounded bg-white/10 px-2 py-0.5 text-[11px] text-white disabled:opacity-40" disabled={disabled} onClick={() => onChange({ verticalPosition: Math.max(-16, appearance.verticalPosition - 1) })}>Lower</button>
          <button type="button" className="rounded bg-white/10 px-2 py-0.5 text-[11px] text-white disabled:opacity-40" disabled={disabled} onClick={() => onChange({ verticalPosition: Math.min(16, appearance.verticalPosition + 1) })}>Raise</button>
        </span>
      </div>
      <p className="pb-1 text-center text-[11px]" style={{ color: appearance.textColor, backgroundColor: appearance.textBackground }}>
        Preview subtitle text
      </p>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-glass-overlay max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-black/70 p-2">
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function PanelButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-2 text-left text-sm',
        active ? 'bg-[var(--hpr-amber)] text-[var(--hpr-ink)]' : 'text-white hover:bg-white/10',
      )}
    >
      {children}
    </button>
  );
}
