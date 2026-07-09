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
export function parseCustomHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(result).length >= MAX_HEADERS) break;
    const name = rawName.trim();
    if (!HEADER_NAME_PATTERN.test(name)) continue;
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
// (a removed row is a removed header).
export function resolveCustomHeaders(
  existing: Record<string, string>,
  provided: Record<string, string>
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [name, value] of Object.entries(provided)) {
    resolved[name] = name in existing && value === maskApiKey(existing[name]) ? existing[name] : value;
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

export async function resolveApiKeyForService(
  type: ServiceType,
  providedApiKey: string,
  instanceId?: string
): Promise<string> {
  // instanceId is scoped to the requested type: an id belonging to another
  // service type must not resolve (and leak) that row's secret.
  const existing = instanceId
    ? await prisma.serviceConnection.findFirst({ where: { id: instanceId, type } })
    : (await prisma.serviceConnection.findFirst({ where: { type, isDefault: true } }))
      ?? (await prisma.serviceConnection.findFirst({ where: { type } }));
  if (!existing) return providedApiKey;

  // If the UI sends back a masked API key, keep the stored secret.
  if (providedApiKey === maskApiKey(existing.apiKey)) {
    return existing.apiKey;
  }
  return providedApiKey;
}

// Same lookup as resolveApiKeyForService, applied to the custom-header map so a
// re-save that echoes masked values keeps the stored secrets.
export async function resolveCustomHeadersForService(
  type: ServiceType,
  provided: Record<string, string>,
  instanceId?: string
): Promise<Record<string, string>> {
  const existing = instanceId
    ? await prisma.serviceConnection.findFirst({ where: { id: instanceId, type } })
    : (await prisma.serviceConnection.findFirst({ where: { type, isDefault: true } }))
      ?? (await prisma.serviceConnection.findFirst({ where: { type } }));
  if (!existing) return provided;
  return resolveCustomHeaders(parseCustomHeaders(existing.customHeaders), provided);
}
