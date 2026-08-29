declare module '@jellyfin/libass-wasm' {
  interface SubtitlesOctopusOptions {
    video: HTMLVideoElement;
    subUrl?: string;
    subContent?: string;
    workerUrl: string;
    legacyWorkerUrl?: string;
    fallbackFont?: string;
    fonts?: string[];
    availableFonts?: Record<string, string>;
    renderMode?: string;
    timeOffset?: number;
    onError?: () => void;
    dropAllAnimations?: boolean;
    libassMemoryLimit?: number;
    libassGlyphLimit?: number;
    targetFps?: number;
    prescaleFactor?: number;
    prescaleHeightLimit?: number;
    maxRenderHeight?: number;
    resizeVariation?: number;
    renderAhead?: number;
  }

  export default class SubtitlesOctopus {
    constructor(options: SubtitlesOctopusOptions);
    dispose(): void;
    setCurrentTime?(time: number): void;
    freeTrack?(): void;
    setTrackByUrl?(url: string): void;
  }
}
