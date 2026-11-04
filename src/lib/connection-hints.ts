import { lookup } from 'node:dns/promises';

/**
 * Plain-words reasons for a failed connection test. The raw error (for example
 * `connect ECONNREFUSED 192.168.1.10:8989`) is logged, never returned, so the
 * hint is chosen from the error code alone.
 */

export interface HintContext {
  /** Helprr runs inside its Docker image (HELPRR_RUNTIME=docker). */
  inDocker: boolean;
  /** `host.docker.internal` resolves inside this container. */
  hostGatewayResolves: boolean;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.startsWith('127.')
    || hostname === '::1'
    || hostname === '[::1]'
    || hostname === '0.0.0.0';
}

const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function errorCode(error: unknown): string | undefined {
  const own = (error as { code?: unknown })?.code;
  if (typeof own === 'string') return own;
  const cause = (error as { cause?: { code?: unknown } })?.cause?.code;
  return typeof cause === 'string' ? cause : undefined;
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function insteadOfLoopback(context: HintContext): string {
  return context.hostGatewayResolves
    ? "Use your server's IP address, or http://host.docker.internal with the app's port when it runs on the same machine as Helprr."
    : "Use your server's IP address.";
}

/** The hint for a failed test, or null when the error says nothing more specific. */
export function connectionFailureHint(error: unknown, url: string, context: HintContext): string | null {
  const code = errorCode(error);
  const parsed = parse(url);

  if (code === 'ERR_INVALID_URL' || parsed === null) {
    return 'That is not a valid address. It should look like http://192.168.1.10:8989.';
  }
  const loopbackInDocker = context.inDocker && isLoopback(parsed.hostname.toLowerCase());
  if (loopbackInDocker && (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EADDRNOTAVAIL')) {
    // "Usually": with network_mode: host, localhost really is the server.
    return `In Docker, localhost usually means Helprr's own container, so nothing answers there. ${insteadOfLoopback(context)}`;
  }
  const https = parsed.protocol === 'https:';

  const status = (error as { response?: { status?: unknown } })?.response?.status;
  if (status === 404) {
    return 'Something answered, but not the API. Check the address, and the base path if the app has one.';
  }

  switch (code) {
    case 'ECONNREFUSED':
      return 'Nothing is answering at that address and port. Check the port, and that the app is running.';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return context.inDocker
        ? "Helprr can't find that name from inside its container. Use the server's IP address, or a name your network's DNS knows."
        : "Helprr can't find that name. Use the server's IP address, or a name your network's DNS knows.";
    case 'ECONNABORTED':
    case 'ETIMEDOUT':
      return 'No answer in time. Is a firewall blocking it, or is the address wrong?';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return "Helprr can't reach that address. Check the IP address, and that Helprr's machine is on the same network.";
    case 'ECONNRESET':
      return https
        ? 'The connection was cut off. Check the port, and try http:// if the app does not use HTTPS.'
        : 'The connection was cut off. If the app uses HTTPS, start the address with https://.';
    case 'EPROTO':
    case 'ERR_SSL_WRONG_VERSION_NUMBER':
    case 'ERR_SSL_PACKET_LENGTH_TOO_LONG':
      return https
        ? 'That port speaks plain HTTP. Start the address with http:// instead.'
        : 'The connection was cut off. If the app uses HTTPS, start the address with https://.';
    default:
      if (code && TLS_CODES.has(code)) {
        return "The app's HTTPS certificate was refused. Use its http:// address on your network, or give it a certificate from a trusted authority.";
      }
      return null;
  }
}

let gatewayCheck: { at: number; resolves: Promise<boolean> } | null = null;
const GATEWAY_CHECK_TTL_MS = 60_000;

/** Whether `host.docker.internal` resolves here; one lookup a minute, shared by parallel callers. */
function hostGatewayResolves(): Promise<boolean> {
  const now = Date.now();
  if (gatewayCheck && now - gatewayCheck.at < GATEWAY_CHECK_TTL_MS) return gatewayCheck.resolves;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resolves = Promise.race([
    lookup('host.docker.internal').then(() => true, () => false),
    new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 1000); }),
  ]).finally(() => clearTimeout(timer));
  gatewayCheck = { at: now, resolves };
  return resolves;
}

/**
 * The context for a hint about `url`. The gateway lookup only matters for a
 * loopback address inside Docker, so nothing else waits on it.
 */
export async function currentHintContext(url: string): Promise<HintContext> {
  const inDocker = process.env.HELPRR_RUNTIME === 'docker';
  const hostname = parse(url)?.hostname.toLowerCase();
  const needsGateway = inDocker && hostname !== undefined && isLoopback(hostname);
  return { inDocker, hostGatewayResolves: needsGateway ? await hostGatewayResolves() : false };
}

/** For tests: forget the cached gateway lookup. */
export function resetHintContextCache(): void {
  gatewayCheck = null;
}
