import type { PolicyLayer, VideoTypeKey } from '@/lib/archive/policy';

export interface RuleLayers {
  base: PolicyLayer;
  types: Partial<Record<VideoTypeKey, PolicyLayer>>;
}

export const PRESETS = [
  { id: 'manual', label: 'Manual', description: 'Nothing downloads by itself' },
  { id: 'everything', label: 'Everything', description: 'Videos and live replays, not Shorts' },
  { id: 'long', label: 'Long videos', description: 'Over 20 minutes, not Shorts' },
  { id: 'live', label: 'Live replays only', description: 'Only the replay after a stream' },
] as const;

export type PresetId = (typeof PRESETS)[number]['id'];

const LONG_MINUTES = 20;
const TYPES: VideoTypeKey[] = ['UPLOAD', 'ARCHIVE', 'SHORT'];

// The only fields a preset decides. Everything else on the page is left as it was.
function shape(id: PresetId) {
  return {
    auto: id === 'everything' || id === 'long',
    minutes: id === 'long' ? LONG_MINUTES : undefined,
    UPLOAD: undefined as boolean | undefined,
    ARCHIVE: id === 'live' ? true : undefined,
    SHORT: id === 'everything' || id === 'long' ? false : undefined,
  };
}

export function applyPreset({ base, types }: RuleLayers, id: PresetId): RuleLayers {
  const wanted = shape(id);
  const conditions = { ...base.conditions };
  if (wanted.minutes === undefined) delete conditions.minDurationMinutes;
  else conditions.minDurationMinutes = wanted.minutes;

  const nextTypes = { ...types };
  for (const type of TYPES) {
    const layer = { ...nextTypes[type] };
    delete layer.autoDownload;
    const value = wanted[type as 'UPLOAD' | 'ARCHIVE' | 'SHORT'];
    nextTypes[type] = value === undefined ? layer : { ...layer, autoDownload: value };
  }
  return { base: { ...base, autoDownload: wanted.auto, conditions }, types: nextTypes };
}

/** Which preset these rules amount to, or null when they are something of their own. */
export function presetOf({ base, types }: RuleLayers): PresetId | null {
  const found = PRESETS.find(({ id }) => {
    const wanted = shape(id);
    return (base.autoDownload ?? false) === wanted.auto
      && base.conditions?.minDurationMinutes === wanted.minutes
      && TYPES.every((type) => types[type]?.autoDownload === wanted[type as 'UPLOAD' | 'ARCHIVE' | 'SHORT']);
  });
  return found?.id ?? null;
}
