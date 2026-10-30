import axios from 'axios';
import { prisma } from '@/lib/db';
import { refuseRedirectToAnotherHost } from '@/lib/redirect-guard';
import { getTwitchClientCredentials, TWITCH_HELIX_URL } from '@/lib/twitch/helix';
import { decryptTwitchToken, encryptTwitchToken } from '@/lib/twitch/token-cipher';

const DEVICE_URL = 'https://id.twitch.tv/oauth2/device';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const SCOPE = 'user:read:follows';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const REQUEST_TIMEOUT_MS = 10_000;
const REFRESH_MARGIN_MS = 5 * 60_000;
const MAX_FOLLOW_PAGES = 10;

const requestOptions = { timeout: REQUEST_TIMEOUT_MS, beforeRedirect: refuseRedirectToAnotherHost };

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Twitch's sign-in has no redirect, so it works for a self-hosted address. */
export async function startDeviceLink(userId: string) {
  const { clientId } = await getTwitchClientCredentials();
  const { data } = await axios.post<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  }>(DEVICE_URL, new URLSearchParams({ client_id: clientId, scopes: SCOPE }), requestOptions);

  const pending = {
    deviceCode: encryptTwitchToken(data.device_code),
    deviceExpires: new Date(Date.now() + data.expires_in * 1000),
  };
  await prisma.twitchUserLink.upsert({ where: { userId }, update: pending, create: { userId, ...pending } });
  return { userCode: data.user_code, verificationUri: data.verification_uri, interval: data.interval };
}

async function identify(accessToken: string, clientId: string) {
  const { data } = await axios.get<{ data: Array<{ id: string; login: string }> }>(`${TWITCH_HELIX_URL}/users`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId },
    ...requestOptions,
  });
  return data.data[0];
}

function storedTokens(token: TokenResponse) {
  return {
    accessToken: encryptTwitchToken(token.access_token),
    refreshToken: encryptTwitchToken(token.refresh_token),
    tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
  };
}

export async function pollDeviceLink(userId: string): Promise<'pending' | 'connected' | 'expired'> {
  const link = await prisma.twitchUserLink.findUnique({ where: { userId } });
  const deviceCode = decryptTwitchToken(link?.deviceCode);
  if (!deviceCode || !link?.deviceExpires || link.deviceExpires.getTime() < Date.now()) return 'expired';

  const { clientId, clientSecret } = await getTwitchClientCredentials();
  try {
    const { data } = await axios.post<TokenResponse>(TOKEN_URL, new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      device_code: deviceCode,
      scopes: SCOPE,
      grant_type: DEVICE_GRANT,
    }), requestOptions);
    const user = await identify(data.access_token, clientId);
    await prisma.twitchUserLink.update({
      where: { userId },
      data: { ...storedTokens(data), twitchUserId: user?.id, login: user?.login, deviceCode: null, deviceExpires: null },
    });
    return 'connected';
  } catch (error) {
    const message = axios.isAxiosError(error) ? String((error.response?.data as { message?: unknown })?.message ?? '') : '';
    if (/authorization_pending|slow_down/i.test(message)) return 'pending';
    if (/invalid device code|expired/i.test(message)) return 'expired';
    // Rethrown without the axios error: its config holds the form body with the secret.
    throw new Error('Twitch sign-in failed');
  }
}

async function userAccessToken(userId: string): Promise<{ token: string; clientId: string; twitchUserId: string } | null> {
  const link = await prisma.twitchUserLink.findUnique({ where: { userId } });
  const stored = decryptTwitchToken(link?.accessToken);
  if (!link?.twitchUserId || !stored) return null;

  const { clientId, clientSecret } = await getTwitchClientCredentials();
  if (link.tokenExpiresAt && link.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
    return { token: stored, clientId, twitchUserId: link.twitchUserId };
  }
  const refreshToken = decryptTwitchToken(link.refreshToken);
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post<TokenResponse>(TOKEN_URL, new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }), requestOptions);
    await prisma.twitchUserLink.update({ where: { userId }, data: storedTokens(data) });
    return { token: data.access_token, clientId, twitchUserId: link.twitchUserId };
  } catch {
    return null;
  }
}

export interface FollowedChannel {
  twitchUserId: string;
  login: string;
  displayName: string;
  subscribed: boolean;
}

/** Null when there is no working sign-in, so the page offers one. */
export async function listFollows(userId: string): Promise<FollowedChannel[] | null> {
  const auth = await userAccessToken(userId);
  if (!auth) return null;

  const follows: Array<{ broadcaster_id: string; broadcaster_login: string; broadcaster_name: string }> = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_FOLLOW_PAGES; page += 1) {
    const { data } = await axios.get<{
      data: typeof follows;
      pagination?: { cursor?: string };
    }>(`${TWITCH_HELIX_URL}/channels/followed`, {
      params: { user_id: auth.twitchUserId, first: 100, after: cursor },
      headers: { Authorization: `Bearer ${auth.token}`, 'Client-Id': auth.clientId },
      ...requestOptions,
    }).catch(() => {
      // Rethrown without the axios error: its config holds the bearer token.
      throw new Error('Twitch follows request failed');
    });
    follows.push(...data.data);
    cursor = data.pagination?.cursor;
    if (!cursor) break;
  }

  const subscribed = await prisma.twitchSubscription.findMany({
    where: { userId, streamer: { twitchUserId: { in: follows.map((follow) => follow.broadcaster_id) } } },
    select: { streamer: { select: { twitchUserId: true } } },
  });
  const known = new Set(subscribed.map((row) => row.streamer.twitchUserId));
  return follows.map((follow) => ({
    twitchUserId: follow.broadcaster_id,
    login: follow.broadcaster_login,
    displayName: follow.broadcaster_name,
    subscribed: known.has(follow.broadcaster_id),
  }));
}
