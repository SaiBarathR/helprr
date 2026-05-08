import axios from 'axios';
import crypto from 'crypto';
import { prisma } from '@/lib/db';

export const ANILIST_AUTHORIZE_URL = 'https://anilist.co/api/v2/oauth/authorize';
export const ANILIST_TOKEN_URL = 'https://anilist.co/api/v2/oauth/token';
export const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';

const REFRESH_SAFETY_MARGIN_MS = 60_000;
const ENCRYPTED_TOKEN_PREFIX = 'enc:v1:';
let refreshPromise: Promise<{ accessToken: string; connection: AniListConnectionRow }> | null = null;

export class AniListReauthRequiredError extends Error {
  constructor(message = 'AniList re-authentication required') {
    super(message);
    this.name = 'AniListReauthRequiredError';
  }
}

export interface AniListConnectionRow {
  clientId: string;
  clientSecret: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  username: string | null;
  anilistUserId: number | null;
  avatar: string | null;
  siteUrl: string | null;
  scoreFormat: string | null;
}

interface ConnectionMetadata {
  anilistUserId?: number;
  avatar?: string;
  siteUrl?: string;
  scoreFormat?: string;
}

function parseMetadata(value: unknown): ConnectionMetadata {
  if (!value || typeof value !== 'object') return {};
  return value as ConnectionMetadata;
}

function getTokenEncryptionKey(): Buffer {
  const secret = process.env.JWT_SECRET || process.env.APP_PASSWORD;
  if (!secret) {
    throw new Error('JWT_SECRET or APP_PASSWORD is required to store AniList tokens securely');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptToken(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getTokenEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_TOKEN_PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
}

function decryptToken(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith(ENCRYPTED_TOKEN_PREFIX)) return value;
  const payload = Buffer.from(value.slice(ENCRYPTED_TOKEN_PREFIX.length), 'base64');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getTokenEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function isDefinitiveRefreshAuthFailure(error: unknown): boolean {
  if (error instanceof AniListReauthRequiredError) return true;
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data as { error?: unknown; message?: unknown } | undefined;
    const code = typeof data?.error === 'string' ? data.error : '';
    const message = typeof data?.message === 'string' ? data.message : '';
    return status === 400 && /invalid_grant|expired_refresh_token/i.test(`${code} ${message}`);
  }
  return false;
}

export async function loadAniListConnection(): Promise<AniListConnectionRow | null> {
  const row = await prisma.serviceConnection.findUnique({ where: { type: 'ANILIST' } });
  if (!row) return null;

  const clientId = row.externalUrl?.trim();
  const clientSecret = row.apiKey?.trim();
  if (!clientId || !clientSecret) return null;

  const meta = parseMetadata(row.metadata);

  return {
    clientId,
    clientSecret,
    accessToken: decryptToken(row.accessToken ?? null),
    refreshToken: decryptToken(row.refreshToken ?? null),
    tokenExpiresAt: row.tokenExpiresAt ?? null,
    username: row.username ?? null,
    anilistUserId: typeof meta.anilistUserId === 'number' ? meta.anilistUserId : null,
    avatar: typeof meta.avatar === 'string' ? meta.avatar : null,
    siteUrl: typeof meta.siteUrl === 'string' ? meta.siteUrl : null,
    scoreFormat: typeof meta.scoreFormat === 'string' ? meta.scoreFormat : null,
  };
}

export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(ANILIST_AUTHORIZE_URL);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', params.state);
  return url.toString();
}

interface TokenResponse {
  token_type: string;
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeCodeForToken(params: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<TokenResponse> {
  const response = await axios.post<TokenResponse>(
    ANILIST_TOKEN_URL,
    {
      grant_type: 'authorization_code',
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      code: params.code,
    },
    {
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    }
  );

  return response.data;
}

export async function refreshAccessToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  const response = await axios.post<TokenResponse>(
    ANILIST_TOKEN_URL,
    {
      grant_type: 'refresh_token',
      client_id: params.clientId,
      client_secret: params.clientSecret,
      refresh_token: params.refreshToken,
    },
    {
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    }
  );

  return response.data;
}

export async function persistTokenResponse(token: TokenResponse): Promise<void> {
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000)
    : null;

  await prisma.serviceConnection.update({
    where: { type: 'ANILIST' },
    data: {
      accessToken: encryptToken(token.access_token),
      refreshToken: token.refresh_token ? encryptToken(token.refresh_token) : undefined,
      tokenExpiresAt: expiresAt,
    },
  });
}

export async function clearAniListTokens(): Promise<void> {
  const exists = await prisma.serviceConnection.findUnique({ where: { type: 'ANILIST' } });
  if (!exists) return;
  await prisma.serviceConnection.update({
    where: { type: 'ANILIST' },
    data: {
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
    },
  });
}

export async function deleteAniListConnection(): Promise<void> {
  await prisma.serviceConnection.deleteMany({ where: { type: 'ANILIST' } });
}

export async function getValidAccessToken(options: { forceRefresh?: boolean } = {}): Promise<{
  accessToken: string;
  connection: AniListConnectionRow;
}> {
  const conn = await loadAniListConnection();
  if (!conn) throw new AniListReauthRequiredError('AniList is not connected');

  const isExpired = conn.tokenExpiresAt
    ? conn.tokenExpiresAt.getTime() - Date.now() < REFRESH_SAFETY_MARGIN_MS
    : false;

  if (!options.forceRefresh && conn.accessToken && !isExpired) {
    return { accessToken: conn.accessToken, connection: conn };
  }

  if (!conn.refreshToken) {
    throw new AniListReauthRequiredError('AniList access token expired and no refresh token available');
  }

  if (refreshPromise) return refreshPromise;

  refreshPromise = refreshAniListToken({ ...conn, refreshToken: conn.refreshToken });
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function refreshAniListToken(conn: AniListConnectionRow & { refreshToken: string }): Promise<{
  accessToken: string;
  connection: AniListConnectionRow;
}> {
  try {
    const refreshed = await refreshAccessToken({
      clientId: conn.clientId,
      clientSecret: conn.clientSecret,
      refreshToken: conn.refreshToken,
    });
    await persistTokenResponse(refreshed);
    const fresh = await loadAniListConnection();
    if (!fresh?.accessToken) {
      throw new AniListReauthRequiredError('Failed to persist refreshed AniList token');
    }
    return { accessToken: fresh.accessToken, connection: fresh };
  } catch (error) {
    if (isDefinitiveRefreshAuthFailure(error)) {
      await clearAniListTokens();
      throw error instanceof AniListReauthRequiredError
        ? error
        : new AniListReauthRequiredError('Failed to refresh AniList token');
    }
    throw error;
  }
}

export async function setAniListConnectionMetadata(meta: ConnectionMetadata & { username?: string | null }): Promise<void> {
  const existing = await prisma.serviceConnection.findUnique({ where: { type: 'ANILIST' } });
  if (!existing) return;
  const prev = parseMetadata(existing.metadata);
  const next: ConnectionMetadata = { ...prev };
  if (meta.anilistUserId != null) next.anilistUserId = meta.anilistUserId;
  if (meta.avatar !== undefined) next.avatar = meta.avatar ?? undefined;
  if (meta.siteUrl !== undefined) next.siteUrl = meta.siteUrl ?? undefined;
  if (meta.scoreFormat !== undefined) next.scoreFormat = meta.scoreFormat ?? undefined;

  await prisma.serviceConnection.update({
    where: { type: 'ANILIST' },
    data: {
      ...(meta.username !== undefined ? { username: meta.username } : {}),
      metadata: next as unknown as object,
    },
  });
}
