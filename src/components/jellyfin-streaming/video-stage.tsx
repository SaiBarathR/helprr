'use client';

import { useEffect, useMemo, useState } from 'react';
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

export function VideoStage() {
  const playback = useJellyfinPlayback();
  const mediaRef = useJellyfinMediaRef();
  const [controlsVisible, setControlsVisible] = useState(true);
  const [panel, setPanel] = useState<'none' | 'audio' | 'subs' | 'quality' | 'speed' | 'chapters' | 'stats'>('none');
  const isAudio = playback.item?.MediaType === 'Audio';
  const isActive = playback.status !== 'idle' && Boolean(playback.item);
  const isVideo = isActive && !isAudio;
  const expanded = playback.videoExpanded && isActive;

  useEffect(() => {
    if (!expanded) return undefined;
    const hide = () => {
      if (playback.status === 'playing') setControlsVisible(false);
    };
    const show = () => setControlsVisible(true);
    let timer = window.setTimeout(hide, 3500);
    const bump = () => {
      show();
      window.clearTimeout(timer);
      timer = window.setTimeout(hide, 3500);
    };
    window.addEventListener('pointermove', bump);
    window.addEventListener('keydown', bump);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', bump);
      window.removeEventListener('keydown', bump);
    };
  }, [expanded, playback.status]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!playback.item || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === ' ' || event.key === 'k') { event.preventDefault(); playback.togglePause(); }
      if (event.key === 'ArrowLeft' || event.key === 'j') playback.skip(-10);
      if (event.key === 'ArrowRight' || event.key === 'l') playback.skip(10);
      if (event.key === 'ArrowUp') { event.preventDefault(); playback.setVolume(Math.min(1, playback.volume + 0.05)); }
      if (event.key === 'ArrowDown') { event.preventDefault(); playback.setVolume(Math.max(0, playback.volume - 0.05)); }
      if (event.key === 'f') playback.setVideoExpanded(true);
      if (event.key === 'Escape') {
        playback.setVideoExpanded(false);
        playback.setQueueOpen(false);
      }
      if (event.key === 'm') playback.setMuted(!playback.muted);
      if (event.key === 'n') void playback.next();
      if (event.key === 'p') void playback.previous();
      if (event.key >= '0' && event.key <= '9' && playback.durationSeconds > 0) {
        playback.seek((Number(event.key) / 10) * playback.durationSeconds);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playback]);

  const audios = audioStreams(playback.stream);
  const subs = subtitleStreams(playback.stream);
  const chapters = playback.item?.Chapters ?? playback.stream?.item.Chapters ?? [];
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

  return (
    <>
      <div
        className={cn(
          'overflow-hidden bg-black',
          !isVideo && 'pointer-events-none fixed h-px w-px opacity-0',
          mini && 'fixed right-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 h-36 w-64 rounded-xl border shadow-2xl md:bottom-4',
          isVideo && expanded && 'fixed inset-0 z-[80]',
        )}
      >
        <div
          className={cn('relative h-full w-full', mini && 'cursor-pointer')}
          onClick={() => mini && playback.setVideoExpanded(true)}
        >
          <video
            ref={mediaRef}
            className="h-full w-full bg-black object-contain"
            playsInline
            preload="metadata"
          />

            {expanded && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 right-4 z-20 text-white"
                onClick={() => playback.setVideoExpanded(false)}
                aria-label="Minimize player"
              >
                <ChevronDown />
              </Button>
            )}

            {playback.status === 'loading' && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Loading stream…</div>
            )}
            {playback.error && (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-300">{playback.error}</div>
            )}

            {intro && expanded && (
              <Button className="absolute right-4 bottom-28 z-10" onClick={() => playback.skipSegment(intro)}>
                Skip {intro.Type}
              </Button>
            )}
            {credits && expanded && (
              <Button variant="secondary" className="absolute right-4 bottom-28 z-10" onClick={() => void playback.next()}>
                Next episode
              </Button>
            )}

            {showChrome && (
              <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/80 via-black/20 to-black/50">
                <div className="flex items-start justify-between gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
                  <div>
                    <p className="text-lg font-semibold text-white">{playback.item?.Name}</p>
                    <p className="text-xs text-white/70">
                      {playback.item?.SeriesName
                        ? `${playback.item.SeriesName} · S${playback.item.ParentIndexNumber ?? 0}E${playback.item.IndexNumber ?? 0}`
                        : playback.item?.ProductionYear}
                      {playback.stream ? ` · ${playMethodLabel(playback.stream.playMethod)}` : ''}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="text-white" onClick={() => playback.setVideoExpanded(false)} aria-label="Minimize player">
                    <ChevronDown />
                  </Button>
                </div>

                <div className="space-y-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  <input
                    type="range"
                    min={0}
                    max={playback.durationSeconds || 1}
                    step={0.1}
                    value={playback.positionSeconds}
                    aria-label="Seek"
                    className="w-full accent-[var(--hpr-amber)]"
                    onChange={(event) => playback.seek(Number(event.target.value))}
                  />
                  <div className="flex items-center justify-between text-[11px] text-white/70">
                    <span>{formatClock(playback.positionSeconds)}</span>
                    <span>{formatClock(playback.durationSeconds)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="text-white" onClick={() => playback.skip(-10)} aria-label="Back 10 seconds">
                        <SkipBack />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-white" onClick={playback.togglePause} aria-label={playback.status === 'paused' ? 'Play' : 'Pause'}>
                        {playback.status === 'paused' ? <Play className="fill-current" /> : <Pause className="fill-current" />}
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
                        className="w-20 accent-[var(--hpr-amber)]"
                        onChange={(event) => {
                          playback.setMuted(false);
                          playback.setVolume(Number(event.target.value));
                        }}
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1">
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
                      <Button variant="ghost" size="icon" className="text-white" onClick={() => setPanel(panel === 'subs' ? 'none' : 'subs')} aria-label="Subtitles">
                        <Subtitles />
                      </Button>
                      {chapters.length > 0 && (
                        <Button variant="ghost" size="sm" className="text-white" onClick={() => setPanel(panel === 'chapters' ? 'none' : 'chapters')}>Chapters</Button>
                      )}
                      <Button variant="ghost" size="icon" className="text-white" onClick={() => setPanel(panel === 'quality' ? 'none' : 'quality')} aria-label="Quality">
                        <Gauge />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-white" onClick={() => setPanel(panel === 'speed' ? 'none' : 'speed')}>
                        {playback.playbackRate}x
                      </Button>
                      <Button variant="ghost" size="icon" className="text-white" onClick={() => playback.setQueueOpen(!playback.queueOpen)} aria-label="Queue">
                        <ListMusic />
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
                      <Button variant="ghost" size="sm" className="text-white" onClick={() => setPanel(panel === 'stats' ? 'none' : 'stats')}>Stats</Button>
                      <Button variant="ghost" size="icon" className="text-white" onClick={() => void playback.stop()} aria-label="Stop">
                        <X />
                      </Button>
                    </div>
                  </div>
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
                </div>
              </div>
            )}

            {mini && (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/70 p-1">
                <Button variant="ghost" size="icon-xs" className="text-white" onClick={(event) => { event.stopPropagation(); playback.togglePause(); }}>
                  {playback.status === 'paused' ? <Play className="fill-current" /> : <Pause className="fill-current" />}
                </Button>
                <div className="h-0.5 flex-1 rounded bg-white/20">
                  <div className="h-full rounded bg-[var(--hpr-amber)]" style={{ width: `${progress * 100}%` }} />
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
              <input
                type="range"
                min={0}
                max={playback.durationSeconds || 1}
                step={0.1}
                value={playback.positionSeconds}
                aria-label="Seek"
                className="w-full accent-[var(--hpr-amber)]"
                onChange={(event) => playback.seek(Number(event.target.value))}
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
        <div className="fixed inset-y-0 right-0 z-[90] flex w-full max-w-sm flex-col border-l bg-background shadow-2xl">
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

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-h-48 overflow-y-auto rounded-lg bg-black/70 p-2">
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
