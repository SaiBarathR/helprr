import axios, { isAxiosError } from 'axios';
import { prisma } from '@/lib/db';
import { decryptTwitchToken } from '@/lib/twitch/token-cipher';
import { isChannelId, isVideoId } from '@/lib/youtube/ids';
import { getYoutubeSettings } from '@/lib/youtube/settings';

export const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3';
export const DAILY_QUOTA = 10_000;
// Google keeps search apart: 100 calls a day, whatever the units above say.
export const DAILY_SEARCHES = 100;
const LIMITS = { quotaUsed: DAILY_QUOTA, quotaSearches: DAILY_SEARCHES };
const SLOW_DOWN_AT = 0.8;
const STOP_AT = 0.95;
const TIMEOUT_MS = 15_000;
const BATCH = 50;
// Any public channel: a one-unit call proves the key works.
const TEST_CHANNEL = 'UCBR8-60-B28hp2BmDPdntcQ';

export class YoutubeKeyRejectedError extends Error {
  constructor(message = 'YouTube rejected the API key') {
    super(message);
    this.name = 'YoutubeKeyRejectedError';
  }
}

export class YoutubeQuotaError extends Error {
  constructor(message = 'The daily YouTube quota is used up. It resets at midnight Pacific time.') {
    super(message);
    this.name = 'YoutubeQuotaError';
  }
}

/** Google resets the quota at midnight Pacific, so the count is kept by that day. */
export function pacificDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
}

export async function quotaState(now = new Date()) {
  const { quotaDay, quotaUsed, quotaSearches } = await getYoutubeSettings();
  const today = quotaDay === pacificDay(now);
  const used = today ? quotaUsed : 0;
  return {
    used,
    limit: DAILY_QUOTA,
    searches: today ? quotaSearches : 0,
    searchLimit: DAILY_SEARCHES,
    slowDown: used >= DAILY_QUOTA * SLOW_DOWN_AT,
    stopped: used >= DAILY_QUOTA * STOP_AT,
  };
}

// Each step is a single conditional UPDATE, so requests running together can neither
// lose a count nor all slip past the limit.
async function spend(counter: keyof typeof LIMITS, now = new Date()): Promise<void> {
  await getYoutubeSettings();
  const day = pacificDay(now);
  await prisma.youtubeSettings.updateMany({
    where: { id: 'singleton', OR: [{ quotaDay: null }, { quotaDay: { not: day } }] },
    data: { quotaDay: day, quotaUsed: 0, quotaSearches: 0 },
  });
  const { count } = await prisma.youtubeSettings.updateMany({
    where: { id: 'singleton', quotaDay: day, [counter]: { lt: LIMITS[counter] * STOP_AT } },
    data: { [counter]: { increment: 1 } },
  });
  if (count > 0) return;
  throw counter === 'quotaSearches'
    ? new YoutubeQuotaError('The daily limit of YouTube searches is used up. Paste the channel\'s link instead, or try again after midnight Pacific time.')
    : new YoutubeQuotaError();
}

export async function storedApiKey(): Promise<string | null> {
  const connection = await prisma.serviceConnection.findFirst({ where: { type: 'YOUTUBE' }, select: { apiKey: true } });
  return decryptTwitchToken(connection?.apiKey);
}

const QUOTA_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded']);
const KEY_REASONS = new Set(['keyInvalid', 'API_KEY_INVALID', 'accessNotConfigured', 'API_KEY_SERVICE_BLOCKED']);

// Google can put a vague reason first: a bad key is badRequest in errors, API_KEY_INVALID in details.
function reasonsOf(error: unknown): string[] {
  if (!isAxiosError(error)) return [];
  const body = (error.response?.data as { error?: { errors?: Array<{ reason?: string }>; details?: Array<{ reason?: string }> } } | undefined)?.error;
  return [...(body?.errors ?? []), ...(body?.details ?? [])].flatMap(({ reason }) => (reason ? [reason] : []));
}

// The key travels in a header, so it can never appear in a URL, a log or an error message.
async function request<T>(path: string, params: Record<string, string | number>, key: string): Promise<T | null> {
  try {
    const { data } = await axios.get<T>(`${YOUTUBE_API_URL}/${path}`, {
      params,
      headers: { 'X-Goog-Api-Key': key },
      timeout: TIMEOUT_MS,
      // Google never redirects these, and a redirect would carry the key's header to another host.
      maxRedirects: 0,
    });
    return data;
  } catch (error) {
    const reasons = reasonsOf(error);
    if (reasons.some((reason) => QUOTA_REASONS.has(reason))) throw new YoutubeQuotaError();
    if (reasons.some((reason) => KEY_REASONS.has(reason))) throw new YoutubeKeyRejectedError();
    // A list a channel does not have answers 404, which is an answer.
    if (reasons.includes('playlistNotFound') || (isAxiosError(error) && error.response?.status === 404)) return null;
    throw new Error(`YouTube request failed: ${isAxiosError(error) ? error.response?.status ?? error.code : 'unknown'}`);
  }
}

async function call<T>(path: string, params: Record<string, string | number>, counter: keyof typeof LIMITS = 'quotaUsed'): Promise<T | null> {
  const key = await storedApiKey();
  if (!key) throw new YoutubeKeyRejectedError('YouTube is not connected');
  await spend(counter);
  return request<T>(path, params, key);
}

/** A person pressing a button, about a key that may not be the counted one, so the count does not hold it back. */
export async function verifyYoutubeKey(key: string): Promise<void> {
  await request('channels', { part: 'id', id: TEST_CHANNEL }, key);
}

/** For the health poller, which probes every connection often: costs no quota and uses no key. */
export async function youtubeReachable(): Promise<void> {
  await axios.head(`${YOUTUBE_API_URL}/videos`, { timeout: TIMEOUT_MS, maxRedirects: 0, validateStatus: (status) => status < 500 });
}

export interface YoutubeChannel {
  id: string;
  title: string;
  handle: string | null;
  description: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  uploadsPlaylistId: string | null;
}

interface Thumbnails {
  default?: { url: string };
  medium?: { url: string };
  high?: { url: string };
  standard?: { url: string };
  maxres?: { url: string };
}

const bestThumbnail = (thumbnails: Thumbnails | undefined) => (
  thumbnails?.maxres?.url ?? thumbnails?.standard?.url ?? thumbnails?.high?.url ?? thumbnails?.medium?.url ?? thumbnails?.default?.url ?? null
);

interface ChannelResource {
  id: string;
  snippet: { title: string; customUrl?: string; description?: string; thumbnails?: Thumbnails };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
  brandingSettings?: { image?: { bannerExternalUrl?: string } };
}

function toChannel(channel: ChannelResource): YoutubeChannel {
  if (!isChannelId(channel.id)) throw new Error('YouTube request failed: malformed channel id');
  return {
    id: channel.id,
    title: channel.snippet.title,
    handle: channel.snippet.customUrl ?? null,
    description: channel.snippet.description || null,
    avatarUrl: bestThumbnail(channel.snippet.thumbnails),
    bannerUrl: channel.brandingSettings?.image?.bannerExternalUrl ?? null,
    uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

async function fetchChannel(params: Record<string, string>): Promise<YoutubeChannel | null> {
  const data = await call<{ items?: ChannelResource[] }>('channels', { part: 'snippet,contentDetails,brandingSettings', ...params });
  return data?.items?.[0] ? toChannel(data.items[0]) : null;
}

export const channelByHandle = (handle: string) => fetchChannel({ forHandle: `@${handle}` });
export const channelById = (id: string) => fetchChannel({ id });

export async function searchChannels(query: string): Promise<YoutubeChannel[]> {
  const data = await call<{ items?: Array<{ id: { channelId?: string }; snippet: ChannelResource['snippet'] }> }>(
    'search',
    { part: 'snippet', type: 'channel', maxResults: 10, q: query },
    'quotaSearches',
  );
  return (data?.items ?? []).flatMap((item) => (
    item.id.channelId ? [toChannel({ id: item.id.channelId, snippet: item.snippet })] : []
  ));
}

export interface YoutubePlaylist {
  id: string;
  title: string;
  ownerName: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  itemCount: number;
}

export async function playlistById(id: string): Promise<YoutubePlaylist | null> {
  const data = await call<{ items?: Array<{
    id: string;
    snippet: { title: string; channelTitle?: string; description?: string; thumbnails?: Thumbnails };
    contentDetails?: { itemCount?: number };
  }> }>('playlists', { part: 'snippet,contentDetails', id });
  const item = data?.items?.[0];
  if (!item) return null;
  return {
    id: item.id,
    title: item.snippet.title,
    ownerName: item.snippet.channelTitle ?? null,
    description: item.snippet.description || null,
    thumbnailUrl: bestThumbnail(item.snippet.thumbnails),
    itemCount: item.contentDetails?.itemCount ?? 0,
  };
}

export interface PlaylistPage {
  items: Array<{ videoId: string; position: number; title: string }>;
  total: number;
  nextPageToken: string | null;
}

/** Null when the list does not exist: a channel with no Shorts has no Shorts list. */
export async function playlistItems(playlistId: string, maxResults = BATCH, pageToken?: string): Promise<PlaylistPage | null> {
  const data = await call<{
    items?: Array<{ snippet?: { position?: number; title?: string }; contentDetails: { videoId: string } }>;
    pageInfo?: { totalResults?: number };
    nextPageToken?: string;
  }>('playlistItems', { part: 'contentDetails,snippet', maxResults, playlistId, ...(pageToken ? { pageToken } : {}) });
  if (!data) return null;
  return {
    items: (data.items ?? []).filter((item) => isVideoId(item.contentDetails.videoId)).map((item, index) => ({
      videoId: item.contentDetails.videoId,
      position: item.snippet?.position ?? index,
      title: item.snippet?.title ?? '',
    })),
    total: data.pageInfo?.totalResults ?? 0,
    nextPageToken: data.nextPageToken ?? null,
  };
}

/** PT3H12M50S to seconds. A live or upcoming video has none yet. */
export function parseIsoDuration(value: string | undefined): number {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value ?? '');
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match.map((part) => Number(part ?? 0));
  return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

export interface YoutubeVideo {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string | null;
  publishedAt: Date;
  durationSeconds: number;
  thumbnailUrl: string | null;
  viewCount: number;
  liveState: 'none' | 'live' | 'upcoming';
  liveEndedAt: Date | null;
  wasLive: boolean;
  ageRestricted: boolean;
}

interface VideoResource {
  id: string;
  snippet: {
    channelId: string;
    channelTitle: string;
    title: string;
    description?: string;
    publishedAt: string;
    thumbnails?: Thumbnails;
    liveBroadcastContent?: string;
  };
  contentDetails?: { duration?: string; contentRating?: { ytRating?: string } };
  liveStreamingDetails?: { actualStartTime?: string; actualEndTime?: string };
  statistics?: { viewCount?: string };
}

function toVideo(video: VideoResource): YoutubeVideo {
  const live = video.snippet.liveBroadcastContent;
  return {
    id: video.id,
    channelId: video.snippet.channelId,
    channelTitle: video.snippet.channelTitle,
    title: video.snippet.title,
    description: video.snippet.description || null,
    publishedAt: new Date(video.snippet.publishedAt),
    durationSeconds: parseIsoDuration(video.contentDetails?.duration),
    thumbnailUrl: bestThumbnail(video.snippet.thumbnails),
    viewCount: Number(video.statistics?.viewCount ?? 0),
    liveState: live === 'live' || live === 'upcoming' ? live : 'none',
    liveEndedAt: video.liveStreamingDetails?.actualEndTime ? new Date(video.liveStreamingDetails.actualEndTime) : null,
    wasLive: Boolean(video.liveStreamingDetails?.actualStartTime),
    ageRestricted: video.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted',
  };
}

export async function videosById(ids: string[]): Promise<YoutubeVideo[]> {
  const videos: YoutubeVideo[] = [];
  for (let start = 0; start < ids.length; start += BATCH) {
    const data = await call<{ items?: VideoResource[] }>('videos', {
      part: 'snippet,contentDetails,liveStreamingDetails,statistics',
      id: ids.slice(start, start + BATCH).join(','),
    });
    // An id ends up in a file name, so even Google's answer is checked first.
    videos.push(...(data?.items ?? []).filter((item) => isVideoId(item.id) && isChannelId(item.snippet.channelId)).map(toVideo));
  }
  return videos;
}

export const uploadsListOf = (channelId: string) => `UU${channelId.slice(2)}`;

/** A Shorts list is one more unit, so only a video short enough to be one is checked. */
export const shortsListOf = (channelId: string) => `UUSH${channelId.slice(2)}`;
