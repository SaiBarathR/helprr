/**
 * The last options used to add a title, remembered per service and per
 * instance on this device, so the add pages and the Seerr request dialog open
 * on the user's usual quality profile and root folder instead of the first one
 * (Add Series/Movie fall back to Seerr's default for that instance, then the first).
 * Ids are instance-local, so a value is only ever applied to the instance (or
 * Seerr server) it was saved for, and only while that instance still lists it.
 */

export type AddDefaultsScope = 'sonarr' | 'radarr' | 'lidarr' | 'seerr-sonarr' | 'seerr-radarr';

export interface AddDefaults {
  profileId?: string;
  rootFolder?: string;
  monitor?: string;
  metadataProfileId?: string;
}

const FIELDS = ['profileId', 'rootFolder', 'monitor', 'metadataProfileId'] as const;

function storageKey(scope: AddDefaultsScope, instanceId: string) {
  return `helprr-add-defaults:${scope}:${instanceId}`;
}

export function readAddDefaults(scope: AddDefaultsScope, instanceId: string | null | undefined): AddDefaults {
  if (!instanceId) return {};
  try {
    const raw = localStorage.getItem(storageKey(scope, instanceId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: AddDefaults = {};
    for (const field of FIELDS) {
      const value = (parsed as Record<string, unknown>)[field];
      if (typeof value === 'string' && value) out[field] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveAddDefaults(scope: AddDefaultsScope, instanceId: string | null | undefined, defaults: AddDefaults) {
  if (!instanceId) return;
  try {
    localStorage.setItem(storageKey(scope, instanceId), JSON.stringify(defaults));
  } catch {
    // best-effort — the next add just starts from the first option again
  }
}

/**
 * The first preferred value `options` still contains (the remembered one, then any
 * fallback such as Seerr's default), else the first option.
 */
export function pickRememberedOption(options: string[], ...preferred: Array<string | null | undefined>): string | undefined {
  return preferred.find((value): value is string => typeof value === 'string' && options.includes(value)) ?? options[0];
}
