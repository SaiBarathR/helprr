import type { ArchiveJob, ArchiveSettings, Creator, CreatorVideo, Prisma, PrismaClient, ArchivePlatform } from '@prisma/client';
import type { DownloadOptions } from '@/lib/twitch/jobs';

export interface DownloadContext {
  prisma: PrismaClient;
  job: ArchiveJob;
  video: CreatorVideo & { creator: Creator };
  options: DownloadOptions;
  signal: AbortSignal;
  minFreeGb: number;
  reencodeEnabled: boolean;
  cookiesFile: string | null;
  browserToken: string | null;
  setStage: (stage: string) => Promise<void>;
  assertLease: () => Promise<void>;
  stagingName: string;
  note: (message: string) => Promise<void>;
}

/** What a platform knows before the download starts. */
export interface PreparedDownload<Info = unknown> {
  info: Info;
  duration: number;
  /** Space the download will need, for the disk guard. */
  expectedBytes: number;
  audioOnly: boolean;
}

/** A finished file in staging, and the ending it takes on the published name. */
export interface Sidecar {
  stagedPath: string;
  suffix: string;
}

export interface EpisodeLayout {
  seriesFolder: string;
  seasonFolder: string;
  baseName: string;
  tvshowNfo: string;
  seasonNfo: string;
  episodeNfo: string;
  /** Series artwork by file name. Each is only ever fetched once. */
  artwork: Array<[name: string, url: string | null]>;
  thumbnailUrl: string | null;
  videoUpdate: Prisma.CreatorVideoUpdateInput;
}

export interface DownloadSession {
  cookiesFile: string | null;
  browserToken: string | null;
  release: () => Promise<void>;
}

/** Everything the shared pipeline needs to ask a platform. */
export interface PlatformAdapter<Info = unknown> {
  readonly platform: ArchivePlatform;
  openSession(settings: ArchiveSettings | null): Promise<DownloadSession>;
  /** Throws if the video is not ready to download. */
  prepare(ctx: DownloadContext): Promise<PreparedDownload<Info>>;
  /** Returns the finished MKV in staging. */
  download(ctx: DownloadContext, staging: string, prepared: PreparedDownload<Info>): Promise<string>;
  /** Files beyond the video. Losing one of these never costs the video. */
  extras(ctx: DownloadContext, staging: string): Promise<Sidecar[]>;
  layout(ctx: DownloadContext, prepared: PreparedDownload<Info>, duration: number): Promise<EpisodeLayout>;
  /** The worker fetches these URLs, so each platform names its own image hosts. */
  isArtworkUrl(url: string): boolean;
}
