// The link a Sonarr/Radarr/Lidarr health push opens: Settings → Service status
// with that instance's health sheet open. Dependency-free so the pollers and
// the page share it.
export const HEALTH_SERVICES = ['sonarr', 'radarr', 'lidarr'] as const;
export type HealthService = (typeof HEALTH_SERVICES)[number];

export function arrHealthHref(service: HealthService, instanceId: string): string {
  return `/settings/status?health=${service}&instance=${encodeURIComponent(instanceId)}`;
}

/** The health sheet a Service status link asks for, or null when it names none. */
export function parseArrHealthLink(params: URLSearchParams): { service: HealthService; instanceId: string } | null {
  const service = params.get('health');
  const instanceId = params.get('instance');
  if (!instanceId || !(HEALTH_SERVICES as readonly string[]).includes(service ?? '')) return null;
  return { service: service as HealthService, instanceId };
}
