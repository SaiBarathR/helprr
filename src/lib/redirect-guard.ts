/**
 * Keeps what Helprr sends a service on the host that service was configured at.
 *
 * The HTTP client follows redirects and resends the request as it stands. On a
 * redirect to another host it drops `Authorization` and `Cookie`, but not the
 * `X-Api-Key` header the *arr family and Seerr authenticate with, nor custom
 * proxy headers, nor a body resent on a 307 or 308, which for a sign-in is the
 * password. So a redirect that leaves the host is not followed at all: the
 * request fails, and the connection's URL is the thing to correct.
 *
 * The same host and port is still followed, including an upgrade from http to
 * https. Pass this as `beforeRedirect` to every client that carries a credential.
 */
export class RedirectRefusedError extends Error {}

/** Shown where a person is waiting on the answer, such as a connection test. */
export const REDIRECT_REFUSED_MESSAGE = 'This URL redirects to another address. Enter the address the service itself answers on.';

/** Whether a request failed because of the refusal below. The HTTP client wraps the error twice. */
export function isRefusedRedirect(error: unknown): boolean {
  for (let cause = error, depth = 0; cause && depth < 5; depth += 1) {
    if (cause instanceof RedirectRefusedError) return true;
    cause = (cause as { cause?: unknown }).cause;
  }
  return false;
}

export function refuseRedirectToAnotherHost(
  options: { href?: string },
  _response: unknown,
  request: { url?: string },
): void {
  let from: URL;
  let to: URL;
  try {
    from = new URL(request.url ?? '');
    to = new URL(options.href ?? '');
  } catch {
    throw new RedirectRefusedError('Refusing to follow a redirect whose address could not be read');
  }
  // `host` carries an explicit port and leaves out the scheme's default one.
  const sameHost = to.host === from.host;
  const sameOrSafer = to.protocol === from.protocol || to.protocol === 'https:';
  if (!sameHost || !sameOrSafer) {
    throw new RedirectRefusedError(
      `Refusing to follow a redirect from ${from.protocol}//${from.host} to ${to.protocol}//${to.host}: `
      + 'it would send this service\'s credentials to another address',
    );
  }
}
