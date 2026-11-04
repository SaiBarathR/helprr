/**
 * Thrown when an address answers, but not with the service's API: a web page,
 * a login screen reached through a redirect, or anything else that is not the
 * JSON the API returns. Sonarr, for one, answers any unknown path such as
 * `/settings/general/api/v3/system/status` with its web page and HTTP 200.
 */
export class NotServiceApiError extends Error {
  constructor() {
    super('The address did not answer like the service API');
    this.name = 'NotServiceApiError';
  }
}

/** The version a real API reports: a short token, never a page or an object. */
export function expectServiceVersion(value: unknown): string {
  if (typeof value === 'string') {
    const version = value.trim();
    if (version && version.length <= 64 && !/[<>\s]/.test(version)) return version;
  }
  throw new NotServiceApiError();
}
