import type { NotificationChannel } from '@prisma/client';
import { checkOutboundUrl, isBlockedHostname, OUTBOUND_ADDRESS_MESSAGE, PRIVATE_ADDRESS_MESSAGE, type OutboundRules } from '@/lib/outbound-url';
import { decryptTwitchToken, encryptTwitchToken } from '@/lib/twitch/token-cipher';
import { CHANNEL_CATALOG, type ChannelSummary, type ChannelType } from './catalog';

// Validation and storage of a channel's settings. The non-secret fields live in
// `config` as plain JSON; the secret ones are one enc:v1: encrypted JSON object
// (the cipher two-step sign-in and Twitch tokens use), decrypted only to send.

export type FieldMap = Record<string, string>;

export const REENTER_CHANNEL_SECRET_MESSAGE = 'Enter the secret fields again to send to a different address.';
export const UNREADABLE_SECRETS_MESSAGE = 'The saved secrets cannot be read any more (the server secret changed). Enter them again.';

const MAX_TEXT_LENGTH = 512;
const NTFY_TOPIC = /^[A-Za-z0-9_-]{1,64}$/;
const APPRISE_KEY = /^[A-Za-z0-9_-]{1,128}$/;
const APPRISE_TAG = /^[A-Za-z0-9_-]{1,64}$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
// Headers the HTTP client sets itself, or that would change where or how the request goes.
const RESERVED_HEADERS = new Set(['host', 'content-type', 'content-length', 'transfer-encoding', 'connection', 'authorization', 'cookie']);
const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const EMAIL = /^[^\s@<>()",;:\\[\]]{1,64}@[A-Za-z0-9.-]{1,253}$/;

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function asText(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value.trim() : undefined;
}

/** A stored JSON column as a string map, dropping anything else. */
export function toFieldMap(value: unknown): FieldMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: FieldMap = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

export function encryptSecrets(secrets: FieldMap): string | null {
  return Object.keys(secrets).length > 0 ? encryptTwitchToken(JSON.stringify(secrets)) : null;
}

/** The secrets, {} when none were saved, or null when they no longer decrypt. */
export function decryptSecrets(stored: string | null): FieldMap | null {
  if (!stored) return {};
  const plain = decryptTwitchToken(stored);
  if (plain === null) return null;
  try {
    return toFieldMap(JSON.parse(plain));
  } catch {
    return null;
  }
}

function urlOf(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Where the secrets are sent: changing it needs the secrets entered again. */
export function destinationKey(type: ChannelType, config: FieldMap, secrets: FieldMap): string {
  switch (type) {
    case 'ntfy':
    case 'gotify':
      return (config.serverUrl ?? '').replace(/\/+$/, '');
    case 'webhook':
      return secrets.url ?? '';
    case 'apprise':
      return (config.apiUrl ?? '').replace(/\/+$/, '');
    case 'email':
      return `${(config.host ?? '').toLowerCase()}:${config.port ?? ''}`;
  }
}

/** The host a channel sends to, safe to show: never a path, query or topic. */
export function destinationLabel(type: ChannelType, config: FieldMap, secrets: FieldMap | null): string {
  if (type === 'email') return config.host ?? '';
  const raw = type === 'webhook' ? secrets?.url : type === 'apprise' ? config.apiUrl : config.serverUrl;
  return urlOf(raw)?.host ?? '';
}

export type ChannelInputResult =
  | { ok: true; config: FieldMap; secrets: FieldMap }
  | { ok: false; error: string };

/**
 * Check a channel's settings from the request. `config` replaces the stored
 * non-secret fields. For each secret field: a non-empty string replaces it,
 * null clears it, and leaving it out (or empty) keeps the stored value, but
 * only while the address stays the same, the rule service connections follow.
 * `allowPrivate` is the owner's reach (admins only; see outbound-url.ts).
 */
export function validateChannelInput(
  type: ChannelType,
  rawConfig: unknown,
  rawSecrets: unknown,
  options: OutboundRules & { existing?: { config: FieldMap; secrets: FieldMap } },
): ChannelInputResult {
  const { existing } = options;
  const rules: OutboundRules = { allowPrivate: options.allowPrivate };
  const meta = CHANNEL_CATALOG[type];
  const configIn = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig as Record<string, unknown> : {};
  const secretsIn = rawSecrets && typeof rawSecrets === 'object' && !Array.isArray(rawSecrets) ? rawSecrets as Record<string, unknown> : {};
  const config: FieldMap = {};
  const secrets: FieldMap = {};
  let keptSecret = false;

  for (const field of meta.fields) {
    let value: string | undefined;
    if (field.secret) {
      const given = secretsIn[field.key];
      if (given === null) {
        if (field.required) return { ok: false, error: `${field.label} is required.` };
        continue;
      }
      value = asText(given);
      if (!value && existing?.secrets[field.key]) {
        secrets[field.key] = existing.secrets[field.key];
        keptSecret = true;
        continue;
      }
    } else {
      value = asText(configIn[field.key]) || field.defaultValue;
    }
    if (!value) {
      if (field.required) return { ok: false, error: `${field.label} is required.` };
      continue;
    }
    if (value.length > (field.kind === 'url' ? 2048 : MAX_TEXT_LENGTH) || hasControlChar(value)) {
      return { ok: false, error: `${field.label} is not valid.` };
    }
    if (field.kind === 'url') {
      const checked = checkOutboundUrl(value, rules);
      if (!checked.ok) return { ok: false, error: `${field.label}: ${checked.error}` };
      // A server's base address: Helprr adds the path. A query or fragment there
      // would break it, and a token typed as ?auth= would sit outside the secrets.
      if (field.key !== 'url' && (checked.url.search || checked.url.hash)) {
        return { ok: false, error: `${field.label}: enter the server's address without ? or #.` };
      }
    } else if (field.kind === 'email' && !EMAIL.test(value)) {
      return { ok: false, error: `${field.label} is not an email address.` };
    } else if (field.kind === 'number' && !/^\d{1,5}$/.test(value)) {
      return { ok: false, error: `${field.label} must be a number.` };
    } else if (field.kind === 'select' && !field.options?.some((option) => option.value === value)) {
      return { ok: false, error: `${field.label} is not one of the choices.` };
    }
    (field.secret ? secrets : config)[field.key] = value;
  }

  const typeError = checkTypeRules(type, config, secrets, rules);
  if (typeError) return { ok: false, error: typeError };

  if (existing && keptSecret
    && destinationKey(type, config, secrets) !== destinationKey(type, existing.config, existing.secrets)) {
    return { ok: false, error: REENTER_CHANNEL_SECRET_MESSAGE };
  }
  return { ok: true, config, secrets };
}

function checkTypeRules(type: ChannelType, config: FieldMap, secrets: FieldMap, rules: OutboundRules): string | null {
  switch (type) {
    case 'ntfy':
      if (!NTFY_TOPIC.test(secrets.topic ?? '')) return 'Topic may use letters, digits, - and _ only (up to 64).';
      if (Boolean(config.username) !== Boolean(secrets.password)) return 'Enter both the user name and the password, or neither.';
      return null;
    case 'webhook':
      if (config.headerName && (!HEADER_NAME.test(config.headerName) || RESERVED_HEADERS.has(config.headerName.toLowerCase()))) {
        return 'Secret header name may use letters, digits and - only, and cannot be a standard header.';
      }
      if (secrets.headerValue && !config.headerName) return 'Enter a name for the secret header.';
      return null;
    case 'apprise': {
      if (!APPRISE_KEY.test(config.key ?? '')) return 'Configuration key may use letters, digits, - and _ only.';
      const tags = (config.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean);
      if (tags.some((tag) => !APPRISE_TAG.test(tag))) return 'Tags may use letters, digits, - and _ only, separated by commas.';
      if (tags.length > 0) config.tags = tags.join(', ');
      else delete config.tags;
      return null;
    }
    case 'email': {
      const host = config.host ?? '';
      if (!HOSTNAME.test(host)) return 'Enter the SMTP server\'s name or IP address.';
      if (isBlockedHostname(host)) return OUTBOUND_ADDRESS_MESSAGE;
      if (isBlockedHostname(host, rules)) return PRIVATE_ADDRESS_MESSAGE;
      const port = Number(config.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Port must be between 1 and 65535.';
      if (Boolean(config.username) !== Boolean(secrets.password)) return 'Enter both the user name and the password, or neither.';
      return null;
    }
    default:
      return null;
  }
}

/** The channel as the browser sees it: the config, and the NAMES of the secrets that are set. */
export function serializeChannel(row: NotificationChannel): ChannelSummary {
  const config = toFieldMap(row.config);
  const secrets = decryptSecrets(row.secrets);
  const type = row.type as ChannelType;
  return {
    id: row.id,
    type,
    name: row.name,
    enabled: row.enabled,
    events: row.events,
    config,
    secretsSet: secrets ? Object.keys(secrets).filter((key) => secrets[key]) : [],
    destination: destinationLabel(type, config, secrets),
    consecutiveFailures: row.consecutiveFailures,
    lastFailedAt: row.lastFailedAt?.toISOString() ?? null,
    lastSucceededAt: row.lastSucceededAt?.toISOString() ?? null,
    lastError: secrets === null ? UNREADABLE_SECRETS_MESSAGE : row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}
