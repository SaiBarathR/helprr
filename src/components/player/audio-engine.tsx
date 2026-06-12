'use client';

// Singleton <audio> for music playback (plan §G), mounted in the (app) layout
// so the queue survives navigation. It unmounts on /watch — video and music
// shouldn't fight. Streams client → Jellyfin directly via the universal audio
// endpoint, syncs the element to the music store's play intent, and reports
// /Sessions/Playing* like the video player so the JF dashboard shows the
// session and play counts update.

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useCan } from '@/components/permission-provider';
import {
  audioPlayMethod,
  buildAudioStreamUrl,
  buildPrimaryImageUrl,
  getTicket,
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
  type OkTicket,
} from '@/lib/playback/api';
import { secondsToTicks, ticksToSeconds } from '@/lib/playback/player-machine';
import { useMusicStore, type MusicTrack } from '@/lib/playback/music-store';

const PROGRESS_INTERVAL_MS = 10_000;

interface AudioSession {
  ticket: OkTicket;
  track: MusicTrack;
  playSessionId: string;
}

function Engine() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const sessionRef = useRef<AudioSession | null>(null);
  const loadIdRef = useRef(0);

  const trackId = useMusicStore((s) => s.queue[s.index]?.id ?? null);
  const playing = useMusicStore((s) => s.playing);
  const seekRequest = useMusicStore((s) => s.seekRequest);
  const positionSeconds = useMusicStore((s) => s.positionSeconds);
  const durationSeconds = useMusicStore((s) => s.durationSeconds);

  const progressPayload = (eventName?: 'timeupdate' | 'pause' | 'unpause') => {
    const session = sessionRef.current;
    const audio = audioRef.current;
    if (!session || !audio) return null;
    return {
      ItemId: session.track.id,
      MediaSourceId: session.track.id,
      PlaySessionId: session.playSessionId,
      PositionTicks: secondsToTicks(audio.currentTime),
      PlayMethod: audioPlayMethod(session.track.container),
      CanSeek: true,
      IsPaused: audio.paused,
      EventName: eventName,
    };
  };

  /** Final stop report for the current session. Safe to call repeatedly. */
  const finalize = () => {
    const session = sessionRef.current;
    const audio = audioRef.current;
    if (!session) return;
    sessionRef.current = null;
    reportPlaybackStopped(session.ticket, {
      ItemId: session.track.id,
      MediaSourceId: session.track.id,
      PlaySessionId: session.playSessionId,
      PositionTicks: secondsToTicks(audio?.currentTime ?? 0),
    });
  };

  // ── Track loading ───────────────────────────────────────────────────────────

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    finalize();

    if (!trackId) {
      audio.removeAttribute('src');
      audio.load();
      useMusicStore.getState().setProgress(0, 0);
      return;
    }

    const loadId = ++loadIdRef.current;
    void (async () => {
      try {
        const ticket = await getTicket();
        if (loadId !== loadIdRef.current) return;
        const store = useMusicStore.getState();
        const track = store.queue[store.index];
        if (ticket.status !== 'ok' || !track || track.id !== trackId) {
          if (ticket.status !== 'ok') {
            store.setPlaying(false);
            // The relink dialog lives in the video player's error screen —
            // music has no equivalent surface, so at least say why it's silent.
            toast.error(
              ticket.status === 'notLinked'
                ? 'No Jellyfin account is linked to your profile.'
                : 'Jellyfin sign-in needed — play any movie or episode once to sign in.'
            );
          }
          return;
        }
        const okTicket = ticket as OkTicket;
        const playSessionId = crypto.randomUUID();
        sessionRef.current = { ticket: okTicket, track, playSessionId };
        audio.src = buildAudioStreamUrl(okTicket, track.id, playSessionId);
        useMusicStore
          .getState()
          .setProgress(0, ticksToSeconds(track.runTimeTicks ?? 0));
        if (useMusicStore.getState().playing) {
          void audio.play().catch(() => useMusicStore.getState().setPlaying(false));
        }
        void reportPlaybackStart(okTicket, {
          ItemId: track.id,
          MediaSourceId: track.id,
          PlaySessionId: playSessionId,
          PositionTicks: 0,
          PlayMethod: audioPlayMethod(track.container),
          CanSeek: true,
          IsPaused: !useMusicStore.getState().playing,
        }).catch(() => {});

        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: track.name,
            artist: track.artist ?? '',
            album: track.album ?? '',
            artwork: [
              {
                src: buildPrimaryImageUrl(okTicket, track.albumId ?? track.id),
                sizes: '512x512',
              },
            ],
          });
        }
      } catch {
        if (loadId === loadIdRef.current) useMusicStore.getState().setPlaying(false);
      }
    })();
  }, [trackId]);

  // ── Play-intent sync ────────────────────────────────────────────────────────

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audio.currentSrc) return;
    if (playing && audio.paused) {
      // Replaying a finished track restarts it.
      if (audio.ended) audio.currentTime = 0;
      void audio.play().catch(() => useMusicStore.getState().setPlaying(false));
    } else if (!playing && !audio.paused) {
      audio.pause();
    }
  }, [playing]);

  useEffect(() => {
    if (!seekRequest) return;
    const audio = audioRef.current;
    if (audio && audio.currentSrc) audio.currentTime = seekRequest.seconds;
    // Consume it — a leftover request would re-apply on the next engine mount.
    useMusicStore.setState({ seekRequest: null });
  }, [seekRequest]);

  // ── Element events ──────────────────────────────────────────────────────────

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      const session = sessionRef.current;
      // Transcoded http streams report Infinity — fall back to library runtime.
      const duration =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : ticksToSeconds(session?.track.runTimeTicks ?? 0);
      useMusicStore.getState().setProgress(audio.currentTime, duration);
    };
    const onPlay = () => {
      useMusicStore.getState().setPlaying(true);
      const payload = progressPayload('unpause');
      const session = sessionRef.current;
      if (session && payload) {
        void reportPlaybackProgress(session.ticket, payload).catch(() => {});
      }
    };
    const onPause = () => {
      if (audio.ended) return; // 'ended' handles the advance + reporting
      useMusicStore.getState().setPlaying(false);
      const payload = progressPayload('pause');
      const session = sessionRef.current;
      if (session && payload) {
        void reportPlaybackProgress(session.ticket, payload).catch(() => {});
      }
    };
    const onEnded = () => {
      const store = useMusicStore.getState();
      if (store.repeat === 'one') {
        audio.currentTime = 0;
        void audio.play().catch(() => {});
        return;
      }
      const prevId = store.queue[store.index]?.id;
      store.advance();
      const after = useMusicStore.getState();
      const nextTrack = after.queue[after.index];
      // Same track id adjacent in the queue: the src won't change, so the
      // loading effect won't re-fire — replay manually.
      if (after.playing && nextTrack && nextTrack.id === prevId) {
        audio.currentTime = 0;
        void audio.play().catch(() => {});
      }
    };
    const onError = () => {
      if (!sessionRef.current) return; // src removal fires a spurious error
      useMusicStore.getState().setPlaying(false);
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, []);

  // 10s heartbeat keeps the JF dashboard session live while playing.
  useEffect(() => {
    const timer = setInterval(() => {
      const session = sessionRef.current;
      const audio = audioRef.current;
      if (!session || !audio || audio.paused) return;
      const payload = progressPayload('timeupdate');
      if (payload) void reportPlaybackProgress(session.ticket, payload).catch(() => {});
    }, PROGRESS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // Stop report on PWA kill / tab close (best-effort keepalive) and unmount
  // (navigating into /watch swaps layout groups — intended).
  useEffect(() => {
    const onPageHide = () => finalize();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      finalize();
      // Unmount means the layout group swapped (entering /watch) — don't let
      // the persisted intent auto-resume music when the user comes back.
      useMusicStore.getState().setPlaying(false);
    };
  }, []);

  // ── MediaSession (lock screen / control center) ─────────────────────────────

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [playing]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => useMusicStore.getState().setPlaying(true));
    ms.setActionHandler('pause', () => useMusicStore.getState().setPlaying(false));
    ms.setActionHandler('previoustrack', () => useMusicStore.getState().previous());
    ms.setActionHandler('nexttrack', () => useMusicStore.getState().next());
    ms.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined && details.seekTime !== null) {
        useMusicStore.getState().seek(details.seekTime);
      }
    });
    return () => {
      const actions: MediaSessionAction[] = [
        'play',
        'pause',
        'previoustrack',
        'nexttrack',
        'seekto',
      ];
      actions.forEach((action) => ms.setActionHandler(action, null));
      ms.metadata = null;
    };
  }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    if (durationSeconds > 0) {
      navigator.mediaSession.setPositionState({
        duration: durationSeconds,
        position: Math.min(positionSeconds, durationSeconds),
        playbackRate: 1,
      });
    }
  }, [positionSeconds, durationSeconds]);

  return <audio ref={audioRef} className="hidden" />;
}

export function AudioEngine() {
  const canPlay = useCan('jellyfin.play');
  if (!canPlay) return null;
  return <Engine />;
}
