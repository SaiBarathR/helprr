import type { ServiceConnection, ServiceType } from '@prisma/client';
import { prisma } from '@/lib/db';

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

// Custom HTTP headers let a Helprr server reach an *arr instance that sits
// behind an authenticating reverse proxy (Cloudflare Access, Authelia, basic
// auth). Gated off by default — it only helps split (non-co-located) topologies.
export function customHeadersEnabled(): boolean {
  return process.env.HELPRR_CUSTOM_HEADERS === 'true';
}

const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]+$/;
const MAX_HEADERS = 10;
const MAX_HEADER_VALUE_LENGTH = 2048;

// Control chars (incl. CR/LF) in a header value make Node's HTTP layer throw
// ERR_INVALID_CHAR at request time, which would break every call on that client.
// Reject them here so a bad paste can't brick a connection.
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

// Coerce an untrusted value (request body or stored JSON) into a validated
// name→value map: safe header names only, non-empty trimmed values free of
// control chars, capped in count and length. Invalid entries are dropped.
//
// `Host` is refused: the HTTP client resolves a relative redirect against that
// header when it is set, so a redirect from the real server would carry the API
// key and the other headers to whatever host it named.
export function parseCustomHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(result).length >= MAX_HEADERS) break;
    const name = rawName.trim();
    if (!HEADER_NAME_PATTERN.test(name) || name.toLowerCase() === 'host') continue;
    if (typeof rawValue !== 'string') continue;
    const val = rawValue.trim();
    if (!val || val.length > MAX_HEADER_VALUE_LENGTH || hasControlChar(val)) continue;
    result[name] = val;
  }
  return result;
}

export function maskCustomHeaders(map: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [name, value] of Object.entries(map)) {
    masked[name] = maskApiKey(value);
  }
  return masked;
}

// Mirror resolveApiKeyForService for each header value: if the UI submits back
// the masked value unchanged, keep the stored secret. The provided keyset wins
// (a removed row is a removed header). `sameUrl` false means the stored values
// may not be reused: a mask then resolves to null (see resolveApiKeyForService).
export function resolveCustomHeaders(
  existing: Record<string, string>,
  provided: Record<string, string>,
  sameUrl = true
): Record<string, string> | null {
  const resolved: Record<string, string> = {};
  for (const [name, value] of Object.entries(provided)) {
    if (name in existing && value === maskApiKey(existing[name])) {
      if (!sameUrl) return null;
      resolved[name] = existing[name];
    } else {
      resolved[name] = value;
    }
  }
  return resolved;
}

// Send-time gate: returns the plaintext headers only when the feature is
// enabled, so toggling the flag off stops sending without deleting stored rows.
// Accepts anything carrying the customHeaders column (full row or a select).
export function getConnectionHeaders(conn: Pick<ServiceConnection, 'customHeaders'>): Record<string, string> | undefined {
  if (!customHeadersEnabled()) return undefined;
  const parsed = parseCustomHeaders(conn.customHeaders);
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function isServiceType(value: string): value is ServiceType {
  return ['SONARR', 'RADARR', 'QBITTORRENT', 'PROWLARR', 'JELLYFIN', 'TMDB', 'ANILIST', 'SEERR', 'LIDARR'].includes(
    value
  );
}

// Allowlist of fields safe to send to the browser: apiKey is masked and OAuth
// tokens/metadata never leave the server (legacy AniList rows can hold
// plaintext tokens).
export function serializeConnection(conn: ServiceConnection) {
  return {
    id: conn.id,
    type: conn.type,
    label: conn.label,
    isDefault: conn.isDefault,
    url: conn.url,
    externalUrl: conn.externalUrl,
    username: conn.username,
    apiKey: maskApiKey(conn.apiKey),
    customHeaders: maskCustomHeaders(parseCustomHeaders(conn.customHeaders)),
    tokenExpiresAt: conn.tokenExpiresAt,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
  };
}

/** Shown when a mask is sent with a URL other than the one its secret was stored for. */
export const REENTER_SECRET_MESSAGE = 'Enter the API key and any custom header values again to use a different URL';

export function normalizeServiceUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

// instanceId is scoped to the requested type: an id belonging to another
// service type must not resolve (and leak) that row's secret.
async function findStoredConnection(type: ServiceType, instanceId?: string) {
  return instanceId
    ? prisma.serviceConnection.findFirst({ where: { id: instanceId, type } })
    : (await prisma.serviceConnection.findFirst({ where: { type, isDefault: true } }))
      ?? (await prisma.serviceConnection.findFirst({ where: { type } }));
}

/**
 * If the UI sends back a masked API key, keep the stored secret, but only for
 * the URL it was stored for. A mask sent with another URL resolves to null:
 * honouring it would send the stored key to an address the caller chose, which
 * is how someone allowed to manage instances could read a key they cannot see.
 */
export async function resolveApiKeyForService(
  type: ServiceType,
  providedApiKey: string,
  url: string,
  instanceId?: string
): Promise<string | null> {
  const existing = await findStoredConnection(type, instanceId);
  if (!existing || providedApiKey !== maskApiKey(existing.apiKey)) return providedApiKey;
  return normalizeServiceUrl(existing.url) === normalizeServiceUrl(url) ? existing.apiKey : null;
}

// Same lookup and the same URL rule as resolveApiKeyForService, applied to the
// custom-header map so a re-save that echoes masked values keeps the stored
// secrets.
export async function resolveCustomHeadersForService(
  type: ServiceType,
  provided: Record<string, string>,
  url: string,
  instanceId?: string
): Promise<Record<string, string> | null> {
  const existing = await findStoredConnection(type, instanceId);
  if (!existing) return provided;
  return resolveCustomHeaders(
    parseCustomHeaders(existing.customHeaders),
    provided,
    normalizeServiceUrl(existing.url) === normalizeServiceUrl(url)
  );
}
