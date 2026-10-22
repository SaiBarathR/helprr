const SHELL_VERSION_HEADER = 'x-helprr-shell-version';

export async function hasMatchingShellNonce(response: Response): Promise<boolean> {
  const headerNonce = response.headers.get('content-security-policy')?.match(/'nonce-([^']+)'/)?.[1];
  if (headerNonce === undefined || !response.body) return true;
  const reader = response.clone().body!.getReader();
  const decoder = new TextDecoder();
  let html = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      html += decoder.decode(value, { stream: !done });
      const bodyNonce = html.match(/\snonce\s*=\s*(["'])(.*?)\1/i)?.[2];
      if (bodyNonce !== undefined) return headerNonce === bodyNonce;
      if (done) return true;
    }
  } finally {
    // A cloned stream's cancel waits for its unread sibling; don't await it.
    void reader.cancel().catch(() => {});
  }
}

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
