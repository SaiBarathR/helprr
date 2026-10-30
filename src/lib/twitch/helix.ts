import axios from 'axios';
import { prisma } from '@/lib/db';
import { refuseRedirectToAnotherHost } from '@/lib/redirect-guard';
import { decryptTwitchToken, encryptTwitchToken } from '@/lib/twitch/token-cipher';

export const TWITCH_HELIX_URL = 'https://api.twitch.tv/helix';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const REQUEST_TIMEOUT_MS = 10_000;
const REFRESH_MARGIN_MS = 60 * 60 * 1000;

export class TwitchNotConfiguredError extends Error {
  constructor() {
    super('Twitch is not configured');
    this.name = 'TwitchNotConfiguredError';
  }
}

export class TwitchCredentialsRejectedError extends Error {
  constructor() {
    super('Twitch rejected the client ID or client secret');
    this.name = 'TwitchCredentialsRejectedError';
  }
}

/** A failed Helix call. Carries no request config: that holds the bearer token. */
export class TwitchHelixError extends Error {
  readonly status: number | null;

  constructor(status: number | null, code?: string) {
    super(`Twitch API request failed (${status ?? code ?? 'network'})`);
    this.name = 'TwitchHelixError';
    this.status = status;
  }
}

export interface HelixRateLimit {
  remaining: number | null;
  resetAt: Date | null;
}

export interface HelixPage<T> {
  data: T[];
  cursor: string | null;
  rateLimit: HelixRateLimit;
}

/** Helix durations look like 3h2m1s; anything unreadable counts as 0 rather than failing a sweep. */
export function parseHelixDuration(value: string | null | undefined): number {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value?.trim() ?? '');
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

export function parseRateLimit(headers: Record<string, unknown>): HelixRateLimit {
  const remaining = Number(headers['ratelimit-remaining']);
  const reset = Number(headers['ratelimit-reset']);
  return {
    remaining: headers['ratelimit-remaining'] !== undefined && Number.isFinite(remaining) ? remaining : null,
    resetAt: headers['ratelimit-reset'] !== undefined && Number.isFinite(reset) ? new Date(reset * 1000) : null,
  };
}

/** Client credentials go in the form body: a query string would end up in logs. */
export async function requestTwitchAppToken(
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  try {
    const { data } = await axios.post<{ access_token: string; expires_in: number }>(
      TWITCH_TOKEN_URL,
      new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
      { timeout: REQUEST_TIMEOUT_MS, beforeRedirect: refuseRedirectToAnotherHost },
    );
    return { accessToken: data.access_token, expiresAt: new Date(Date.now() + data.expires_in * 1000) };
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    if (status === 400 || status === 401 || status === 403) throw new TwitchCredentialsRejectedError();
    // Rethrown without the axios error: its config holds the form body with the secret.
    throw new Error(`Twitch token request failed${status ? ` (${status})` : ''}`);
  }
}

async function loadConnection() {
  const connection = await prisma.serviceConnection.findFirst({ where: { type: 'TWITCH' } });
  if (!connection?.externalUrl || !connection.apiKey) throw new TwitchNotConfiguredError();
  return connection;
}

export async function getTwitchClientCredentials(): Promise<{ clientId: string; clientSecret: string }> {
  const connection = await loadConnection();
  return { clientId: connection.externalUrl!, clientSecret: connection.apiKey };
}

let refreshPromise: Promise<string> | null = null;

async function refreshAppToken(): Promise<string> {
  const connection = await loadConnection();
  const { accessToken, expiresAt } = await requestTwitchAppToken(connection.externalUrl!, connection.apiKey);
  await prisma.serviceConnection.update({
    where: { id: connection.id },
    data: { accessToken: encryptTwitchToken(accessToken), tokenExpiresAt: expiresAt },
  });
  return accessToken;
}

function refreshOnce(): Promise<string> {
  refreshPromise ??= refreshAppToken().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function getAppToken(): Promise<{ token: string; clientId: string }> {
  const connection = await loadConnection();
  const stored = decryptTwitchToken(connection.accessToken);
  const fresh = connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS;
  return { token: stored && fresh ? stored : await refreshOnce(), clientId: connection.externalUrl! };
}

/** The cheap health probe: validates the stored token without spending the Helix budget. */
export async function verifyTwitchAppToken(): Promise<void> {
  const { token } = await getAppToken();
  try {
    await axios.get(TWITCH_VALIDATE_URL, {
      headers: { Authorization: `OAuth ${token}` },
      timeout: REQUEST_TIMEOUT_MS,
      beforeRedirect: refuseRedirectToAnotherHost,
    });
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) {
      throw new Error('Twitch token check failed');
    }
    await refreshOnce();
  }
}

/** Query params with a list value repeat the key, as Helix expects (`id=1&id=2`). */
export async function helixGet<T>(
  path: string,
  params: Record<string, string | number | readonly string[] | undefined>,
): Promise<HelixPage<T>> {
  const request = async (token: string, clientId: string) => axios.get<{
    data: T[];
    pagination?: { cursor?: string };
  }>(`${TWITCH_HELIX_URL}${path}`, {
    params,
    paramsSerializer: { indexes: null },
    headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId },
    timeout: REQUEST_TIMEOUT_MS,
    beforeRedirect: refuseRedirectToAnotherHost,
  });

  const { token, clientId } = await getAppToken();
  try {
    let response;
    try {
      response = await request(token, clientId);
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 401) throw error;
      response = await request(await refreshOnce(), clientId);
    }
    return {
      data: response.data.data ?? [],
      cursor: response.data.pagination?.cursor ?? null,
      rateLimit: parseRateLimit(response.headers as Record<string, unknown>),
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new TwitchHelixError(error.response?.status ?? null, error.code);
    }
    throw error;
  }
}
