import type { DownloadOptions } from '@/lib/twitch/jobs';

export interface PolicyConditions {
  titleInclude?: string[];
  titleExclude?: string[];
  categoryInclude?: string[];
  categoryExclude?: string[];
  minDurationMinutes?: number;
  maxDurationMinutes?: number;
}

export interface TwitchPolicy extends DownloadOptions {
  autoDownload: boolean;
  notify: boolean;
  conditions: PolicyConditions;
  keepLatest: number | null;
  deleteAfterDays: number | null;
  deleteAfterWatchedDays: number | null;
}

export type PolicyLayer = Partial<TwitchPolicy>;
export type VideoTypeKey = 'ARCHIVE' | 'HIGHLIGHT' | 'UPLOAD';

export const BUILT_IN_POLICY: TwitchPolicy = {
  autoDownload: false,
  notify: true,
  quality: '1080p60',
  chat: true,
  chapters: true,
  reencode: true,
  keepForever: false,
  conditions: {},
  keepLatest: null,
  deleteAfterDays: null,
  deleteAfterWatchedDays: null,
};

export interface PolicyLayers {
  global?: PolicyLayer;
  type?: PolicyLayer;
  streamer?: PolicyLayer;
  streamerType?: PolicyLayer;
  manual?: PolicyLayer;
}

export interface VideoForPolicy {
  title: string;
  durationSeconds: number;
  category?: string | null;
}

export type PolicyTrace = Partial<Record<keyof TwitchPolicy, keyof PolicyLayers | 'builtIn'>>;

export interface PolicyDecision {
  policy: TwitchPolicy;
  trace: PolicyTrace;
  autoDownloadReason: string;
}

// Least to most specific; a later layer overrides an earlier one field by field.
const LAYER_ORDER = ['global', 'type', 'streamer', 'streamerType', 'manual'] as const;

function conditionFailure(video: VideoForPolicy, conditions: PolicyConditions): string | null {
  const title = video.title.toLowerCase();
  const minutes = video.durationSeconds / 60;
  const excluded = conditions.titleExclude?.find((word) => title.includes(word.toLowerCase()));
  if (excluded) return `title contains "${excluded}"`;
  if (conditions.titleInclude?.length && !conditions.titleInclude.some((word) => title.includes(word.toLowerCase()))) {
    return 'title has none of the wanted words';
  }
  const category = video.category?.toLowerCase();
  const blocked = category ? conditions.categoryExclude?.find((word) => word.toLowerCase() === category) : undefined;
  if (blocked) return `category is ${blocked}`;
  if (conditions.categoryInclude?.length && !conditions.categoryInclude.some((word) => word.toLowerCase() === category)) {
    return category ? 'category is not a wanted one' : 'category is not known';
  }
  if (conditions.minDurationMinutes !== undefined && minutes < conditions.minDurationMinutes) return 'shorter than the minimum';
  if (conditions.maxDurationMinutes !== undefined && minutes > conditions.maxDurationMinutes) return 'longer than the maximum';
  return null;
}

/** Keywords only, never a regex: a rule cannot be made to hang the poller. */
export function evaluatePolicy(video: VideoForPolicy, layers: PolicyLayers, masterSwitch: boolean): PolicyDecision {
  const policy = { ...BUILT_IN_POLICY } as TwitchPolicy & Record<string, unknown>;
  const trace = Object.fromEntries(Object.keys(BUILT_IN_POLICY).map((field) => [field, 'builtIn'])) as PolicyTrace;
  for (const name of LAYER_ORDER) {
    for (const [field, value] of Object.entries(layers[name] ?? {})) {
      if (value === undefined || !(field in BUILT_IN_POLICY)) continue;
      policy[field] = value;
      trace[field as keyof TwitchPolicy] = name;
    }
  }

  // Checked before the rules' answer, so nothing a layer says can get past it.
  if (!masterSwitch) {
    return { policy: { ...policy, autoDownload: false }, trace, autoDownloadReason: 'master-switch' };
  }
  if (!policy.autoDownload) {
    return { policy, trace, autoDownloadReason: trace.autoDownload === 'builtIn' ? 'off by default' : `off in ${trace.autoDownload}` };
  }
  const failure = conditionFailure(video, policy.conditions);
  if (failure) return { policy: { ...policy, autoDownload: false }, trace, autoDownloadReason: failure };
  return { policy, trace, autoDownloadReason: `on in ${trace.autoDownload}` };
}

/** Narrows stored JSON: an unknown field or a wrong type is dropped, never trusted. */
export function sanitizeLayer(value: unknown): PolicyLayer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const layer: PolicyLayer = {};
  for (const field of ['autoDownload', 'notify', 'chat', 'chapters', 'reencode', 'keepForever'] as const) {
    if (typeof input[field] === 'boolean') layer[field] = input[field];
  }
  if (typeof input.quality === 'string' && /^[a-z0-9_]{1,16}$/i.test(input.quality)) layer.quality = input.quality;
  for (const field of ['keepLatest', 'deleteAfterDays', 'deleteAfterWatchedDays'] as const) {
    const number = input[field];
    if (number === null || (typeof number === 'number' && Number.isInteger(number) && number >= 0 && number <= 100_000)) {
      layer[field] = number as number | null;
    }
  }
  const conditions = input.conditions;
  if (conditions && typeof conditions === 'object' && !Array.isArray(conditions)) {
    const raw = conditions as Record<string, unknown>;
    const words = (list: unknown) => (Array.isArray(list)
      ? list.filter((word): word is string => typeof word === 'string' && word.trim() !== '').map((word) => word.trim().slice(0, 100)).slice(0, 50)
      : undefined);
    const minutes = (number: unknown) => (typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : undefined);
    layer.conditions = {
      titleInclude: words(raw.titleInclude),
      titleExclude: words(raw.titleExclude),
      categoryInclude: words(raw.categoryInclude),
      categoryExclude: words(raw.categoryExclude),
      minDurationMinutes: minutes(raw.minDurationMinutes),
      maxDurationMinutes: minutes(raw.maxDurationMinutes),
    };
  }
  return layer;
}

export function layerMap(value: unknown): Partial<Record<VideoTypeKey, PolicyLayer>> {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return Object.fromEntries(
    (['ARCHIVE', 'HIGHLIGHT', 'UPLOAD'] as const)
      .filter((type) => input[type])
      .map((type) => [type, sanitizeLayer(input[type])]),
  );
}
