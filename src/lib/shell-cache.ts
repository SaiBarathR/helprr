const SHELL_VERSION_HEADER = 'x-helprr-shell-version';

/** HTML from an older build can name lazy chunks that no longer exist. */
export function cacheShellResponse(response: Response, version: string): Response | null {
  if (!version || response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) return null;
  const headers = new Headers(response.headers);
  headers.set(SHELL_VERSION_HEADER, version);
  return new Response(response.clone().body, { status: response.status, headers });
}

export function matchingShellResponse(response: Response | undefined, version: string): Response | null {
  return version && response?.headers.get(SHELL_VERSION_HEADER) === version ? response : null;
}
