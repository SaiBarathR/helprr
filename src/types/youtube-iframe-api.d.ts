/**
 * Minimal typings for the slice of the YouTube IFrame Player API that the
 * cinematic trailer backdrop uses. The full API is far larger; typing only
 * what is called keeps the contract honest and the surface reviewable.
 */
declare namespace YT {
  /** -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
  type PlayerState = -1 | 0 | 1 | 2 | 3 | 5;

  interface PlayerEvent {
    target: Player;
  }

  interface OnStateChangeEvent extends PlayerEvent {
    data: PlayerState;
  }

  interface OnErrorEvent extends PlayerEvent {
    /** 2 bad param, 5 HTML5 error, 100 removed, 101/150 embedding disabled. */
    data: number;
  }

  interface PlayerOptions {
    videoId: string;
    width?: number | string;
    height?: number | string;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: (event: PlayerEvent) => void;
      onStateChange?: (event: OnStateChangeEvent) => void;
      onError?: (event: OnErrorEvent) => void;
    };
  }

  class Player {
    constructor(element: HTMLElement | string, options: PlayerOptions);
    playVideo(): void;
    pauseVideo(): void;
    mute(): void;
    unMute(): void;
    setPlaybackQuality(quality: string): void;
    getIframe(): HTMLIFrameElement;
    destroy(): void;
  }

  const PlayerState: {
    UNSTARTED: -1;
    ENDED: 0;
    PLAYING: 1;
    PAUSED: 2;
    BUFFERING: 3;
    CUED: 5;
  };
}

interface Window {
  YT?: typeof YT;
  onYouTubeIframeAPIReady?: () => void;
}
