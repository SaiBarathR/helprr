export type ArrMediaKind = 'movie' | 'series' | 'music';

const EDIT_BASE: Record<ArrMediaKind, string> = {
  movie: '/movies',
  series: '/series',
  music: '/music',
};

/** Radarr/Sonarr/Lidarr edit page href with optional instance query param. */
export function arrEditHref(kind: ArrMediaKind, id: number, instanceId?: string | null): string {
  const base = `${EDIT_BASE[kind]}/${id}/edit`;
  if (!instanceId) return base;
  return `${base}?instance=${encodeURIComponent(instanceId)}`;
}

/** Radarr movie or Sonarr series manage page href. */
export function arrManageHref(
  kind: 'movie' | 'series',
  id: number,
  title: string,
  instanceId?: string | null,
): string {
  const base = `${EDIT_BASE[kind]}/${id}/manage`;
  const params = new URLSearchParams({ title });
  if (instanceId) params.set('instance', instanceId);
  return `${base}?${params.toString()}`;
}

/** Lidarr artist files page href. */
export function arrFilesHref(kind: 'music', id: number, instanceId?: string | null): string {
  const base = `${EDIT_BASE[kind]}/${id}/files`;
  if (!instanceId) return base;
  return `${base}?instance=${encodeURIComponent(instanceId)}`;
}
