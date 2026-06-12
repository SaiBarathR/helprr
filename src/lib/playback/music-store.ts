// Persisted music queue (plan §G). Separate from the UI prefs store so the
// queue survives navigation and PWA relaunch under its own key. Holds light
// track metadata only — never tokens. The audio engine (audio-engine.tsx)
// owns the <audio> element and syncs it to this store's play intent; the
// mini-player and now-playing sheet drive it.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface MusicTrack {
  id: string;
  name: string;
  artist?: string;
  album?: string;
  /** Artwork lookup; falls back to the track's own primary image. */
  albumId?: string;
  runTimeTicks?: number;
  /** File container ("mp3", "flac") — drives the DirectPlay/Transcode report. */
  container?: string;
}

export type RepeatMode = 'off' | 'all' | 'one';

interface MusicState {
  queue: MusicTrack[];
  index: number;
  shuffle: boolean;
  /** Pre-shuffle order so toggling shuffle off restores it. */
  unshuffledQueue: MusicTrack[] | null;
  repeat: RepeatMode;
  /** Play intent — the audio engine syncs the <audio> element to this. */
  playing: boolean;
  positionSeconds: number;
  durationSeconds: number;
  /** One-shot seek request consumed by the audio engine. */
  seekRequest: { seconds: number; id: number } | null;

  playQueue: (tracks: MusicTrack[], startIndex?: number) => void;
  playShuffled: (tracks: MusicTrack[]) => void;
  enqueue: (tracks: MusicTrack[]) => void;
  jumpTo: (index: number) => void;
  next: () => void;
  previous: () => void;
  /** A track finished on its own — honors repeat ('one' is handled engine-side). */
  advance: () => void;
  setPlaying: (playing: boolean) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  seek: (seconds: number) => void;
  setProgress: (positionSeconds: number, durationSeconds: number) => void;
  clear: () => void;
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const PERSISTED_KEYS = ['queue', 'index', 'shuffle', 'unshuffledQueue', 'repeat'] as const;

let seekId = 0;

export const useMusicStore = create<MusicState>()(
  persist(
    (set, get) => ({
      queue: [],
      index: 0,
      shuffle: false,
      unshuffledQueue: null,
      repeat: 'off',
      playing: false,
      positionSeconds: 0,
      durationSeconds: 0,
      seekRequest: null,

      playQueue: (tracks, startIndex = 0) =>
        set({
          queue: tracks,
          index: Math.min(Math.max(startIndex, 0), Math.max(tracks.length - 1, 0)),
          shuffle: false,
          unshuffledQueue: null,
          playing: tracks.length > 0,
          positionSeconds: 0,
          durationSeconds: 0,
          seekRequest: null,
        }),
      playShuffled: (tracks) =>
        set({
          queue: shuffled(tracks),
          index: 0,
          shuffle: true,
          unshuffledQueue: tracks,
          playing: tracks.length > 0,
          positionSeconds: 0,
          durationSeconds: 0,
          seekRequest: null,
        }),
      enqueue: (tracks) =>
        set((state) => ({
          queue: [...state.queue, ...tracks],
          unshuffledQueue: state.unshuffledQueue
            ? [...state.unshuffledQueue, ...tracks]
            : null,
          // An enqueue onto an empty queue starts playback.
          playing: state.queue.length === 0 ? tracks.length > 0 : state.playing,
        })),
      jumpTo: (index) =>
        set((state) =>
          index >= 0 && index < state.queue.length
            ? { index, playing: true, positionSeconds: 0 }
            : {}
        ),
      next: () => {
        const { queue, index, repeat } = get();
        if (queue.length === 0) return;
        if (index + 1 < queue.length) {
          set({ index: index + 1, playing: true, positionSeconds: 0 });
        } else if (repeat === 'all') {
          set({ index: 0, playing: true, positionSeconds: 0 });
        }
      },
      previous: () => {
        const { index, positionSeconds } = get();
        // Like every music player: early in the track goes to the previous
        // one, otherwise restart the current track.
        if (positionSeconds > 3 || index === 0) {
          set({ seekRequest: { seconds: 0, id: ++seekId }, playing: true });
        } else {
          set({ index: index - 1, playing: true, positionSeconds: 0 });
        }
      },
      advance: () => {
        const { queue, index, repeat } = get();
        if (index + 1 < queue.length) {
          set({ index: index + 1, playing: true, positionSeconds: 0 });
        } else if (repeat === 'all' && queue.length > 0) {
          set({ index: 0, playing: true, positionSeconds: 0 });
        } else {
          set({ playing: false });
        }
      },
      setPlaying: (playing) => set({ playing }),
      toggleShuffle: () => {
        const { shuffle, queue, index, unshuffledQueue } = get();
        const current = queue[index];
        if (!shuffle) {
          // Keep the current track playing at the head of the shuffled order.
          const rest = queue.filter((_, i) => i !== index);
          set({
            shuffle: true,
            unshuffledQueue: queue,
            queue: current ? [current, ...shuffled(rest)] : shuffled(queue),
            index: 0,
          });
        } else {
          const restored = unshuffledQueue ?? queue;
          const restoredIndex = current
            ? restored.findIndex((t) => t.id === current.id)
            : 0;
          set({
            shuffle: false,
            unshuffledQueue: null,
            queue: restored,
            index: restoredIndex >= 0 ? restoredIndex : 0,
          });
        }
      },
      cycleRepeat: () =>
        set((state) => ({
          repeat: state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off',
        })),
      seek: (seconds) => set({ seekRequest: { seconds, id: ++seekId } }),
      setProgress: (positionSeconds, durationSeconds) =>
        set({ positionSeconds, durationSeconds }),
      clear: () =>
        set({
          queue: [],
          index: 0,
          shuffle: false,
          unshuffledQueue: null,
          playing: false,
          positionSeconds: 0,
          durationSeconds: 0,
          seekRequest: null,
        }),
    }),
    {
      name: 'helprr-music',
      version: 1,
      partialize: (state) =>
        Object.fromEntries(PERSISTED_KEYS.map((k) => [k, state[k]])) as Partial<MusicState>,
    }
  )
);
