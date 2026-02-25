'use client';

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Play, Pause, Monitor, Video, Music } from 'lucide-react';
import type { JellyfinSession, JellyfinMediaStream } from '@/types/jellyfin';
import {
  getSessionTitle,
  getPlayMethodInfo,
  formatBitrate,
  formatResolution,
  formatTranscodeReason,
  getTranscodeOutputSummary,
} from '@/lib/jellyfin-helpers';

interface StreamInfoDrawerProps {
  session: JellyfinSession | null;
  onClose: () => void;
}

function StreamSection({ stream, isDirect }: { stream: JellyfinMediaStream; isDirect: boolean }) {
  const isVideo = stream.Type === 'Video';
  const Icon = isVideo ? Video : Music;

  return (
    <div className="flex items-start gap-2.5 py-2">
      <div className={`rounded-md p-1.5 shrink-0 ${isVideo ? 'bg-blue-500/10' : 'bg-purple-500/10'}`}>
        <Icon className={`h-3.5 w-3.5 ${isVideo ? 'text-blue-400' : 'text-purple-400'}`} />
      </div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium">{stream.DisplayTitle || stream.Codec?.toUpperCase() || stream.Type}</span>
          <Badge
            variant="outline"
            className={`text-[8px] px-1 py-0 h-3.5 ${isDirect ? 'text-green-500 border-green-500/30' : 'text-orange-400 border-orange-400/30'}`}
          >
            {isDirect ? 'Direct' : 'Transcoding'}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          {stream.Codec && <span>{stream.Codec.toUpperCase()}</span>}
          {isVideo && stream.Width && stream.Height && (
            <span>{formatResolution(stream.Width, stream.Height)} ({stream.Width}x{stream.Height})</span>
          )}
          {isVideo && stream.AverageFrameRate && (
            <span>{stream.AverageFrameRate.toFixed(1)} fps</span>
          )}
          {isVideo && stream.BitDepth && (
            <span>{stream.BitDepth}-bit</span>
          )}
          {isVideo && stream.VideoRange && stream.VideoRange !== 'SDR' && (
            <span>{stream.VideoRange}</span>
          )}
          {isVideo && stream.Profile && (
            <span>{stream.Profile}</span>
          )}
          {!isVideo && stream.Channels && (
            <span>{stream.Channels}ch{stream.ChannelLayout ? ` (${stream.ChannelLayout})` : ''}</span>
          )}
          {stream.BitRate && <span>{formatBitrate(stream.BitRate)}</span>}
          {stream.Language && <span>{stream.Language.toUpperCase()}</span>}
        </div>
      </div>
    </div>
  );
}

export function StreamInfoDrawer({ session, onClose }: StreamInfoDrawerProps) {
  const item = session?.NowPlayingItem;
  const playState = session?.PlayState;
  const ti = session?.TranscodingInfo;
  const playMethod = getPlayMethodInfo(playState?.PlayMethod);
  const mediaStreams = item?.MediaStreams ?? [];
  const videoStreams = mediaStreams.filter((s) => s.Type === 'Video');
  const audioStreams = mediaStreams.filter((s) => s.Type === 'Audio');
  const outputSummary = ti ? getTranscodeOutputSummary(ti) : null;
  const hasTranscodeReasons = ti?.TranscodeReasons && ti.TranscodeReasons.length > 0;
  const isTranscoding = playState?.PlayMethod === 'Transcode';

  return (
    <Drawer open={session !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-2">
          <div className="flex items-center gap-2">
            {playState?.IsPaused
              ? <Pause className="h-4 w-4 text-amber-400 shrink-0" />
              : <Play className="h-4 w-4 text-green-400 shrink-0" />
            }
            <DrawerTitle className="text-sm truncate">
              {item ? getSessionTitle(item) : 'Unknown'}
            </DrawerTitle>
          </div>
          {session && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
              <Monitor className="h-3 w-3" />
              <span>{session.UserName} &middot; {session.DeviceName}</span>
              {session.Client && <span>&middot; {session.Client}</span>}
            </div>
          )}
        </DrawerHeader>

        <div className="px-4 pb-6 space-y-4 overflow-y-auto">
          {/* Play Method */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-1">
            <span className={`text-sm font-semibold ${playMethod.color}`}>
              {playMethod.label}
            </span>
            <p className="text-[11px] text-muted-foreground">{playMethod.description}</p>
          </div>

          {/* Output Format (transcoding only) */}
          {isTranscoding && ti && outputSummary && (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Output</h4>
              <div className="rounded-lg bg-muted/50 p-3 space-y-1">
                <p className="text-xs font-medium">{outputSummary}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                  {ti.Width && ti.Height && (
                    <span>{formatResolution(ti.Width, ti.Height)} ({ti.Width}x{ti.Height})</span>
                  )}
                  {ti.HardwareAccelerationType?.trim() && (
                    <span>HW: {ti.HardwareAccelerationType}</span>
                  )}
                  {ti.Framerate && (
                    <span>Transcoding Framerate: {ti.Framerate} FPS</span>
                  )}
                  {ti.VideoCodec?.trim() && (
                    <span>Video codec: {ti.VideoCodec.toUpperCase()} {ti.IsVideoDirect ? '(direct)' : '(transcoded)'}</span>
                  )}
                  {ti.AudioCodec?.trim() && (
                    <span>Audio codec: {ti.AudioCodec.toUpperCase()} {ti.IsAudioDirect ? '(direct)' : '(transcoded)'}</span>
                  )}
                  {ti.AudioChannels && (
                    <span>{ti.AudioChannels}ch audio</span>
                  )}
                </div>

              </div>
            </div>
          )}

          {/* Transcode Reasons */}
          {isTranscoding && hasTranscodeReasons && (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Transcode Reasons</h4>
              <div className="space-y-1">
                {ti!.TranscodeReasons!.map((reason) => (
                  <div key={reason} className="flex items-start gap-2 text-[11px]">
                    <span className="text-orange-400 shrink-0">&bull;</span>
                    <span className="text-muted-foreground">{formatTranscodeReason(reason)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stream Details */}
          {(videoStreams.length > 0 || audioStreams.length > 0) && (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Source Streams</h4>
              <div className="divide-y divide-border/50">
                {videoStreams.map((stream, i) => (
                  <StreamSection
                    key={`video-${i}`}
                    stream={stream}
                    isDirect={ti ? ti.IsVideoDirect : playState?.PlayMethod !== 'Transcode'}
                  />
                ))}
                {audioStreams.map((stream, i) => (
                  <StreamSection
                    key={`audio-${i}`}
                    stream={stream}
                    isDirect={ti ? ti.IsAudioDirect : playState?.PlayMethod !== 'Transcode'}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Fallback when no detailed stream info */}
          {videoStreams.length === 0 && audioStreams.length === 0 && ti && (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Codec Info</h4>
              <div className="rounded-lg bg-muted/50 p-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {ti.VideoCodec && (
                  <span>Video: {ti.VideoCodec.toUpperCase()} ({ti.IsVideoDirect ? 'direct' : 'transcode'})</span>
                )}
                {ti.AudioCodec && (
                  <span>Audio: {ti.AudioCodec.toUpperCase()} ({ti.IsAudioDirect ? 'direct' : 'transcode'})</span>
                )}
                {ti.Container && <span>Container: {ti.Container.toUpperCase()}</span>}
              </div>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
