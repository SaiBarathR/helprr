import axios, { AxiosError } from 'axios';
import { noteAniListRateHeaders, noteAniListRateLimited, rateLimitWait } from '@/lib/anilist-client';
import {
  AniListReauthRequiredError,
  ANILIST_GRAPHQL_URL,
  clearAniListTokens,
  getValidAccessToken,
} from '@/lib/anilist-oauth';

interface GqlResponse<T> {
  data: T;
  errors?: Array<{ message: string; status?: number }>;
}

const TIMEOUT_MS = 15_000;

async function performRequest<T>(
  query: string,
  variables: Record<string, unknown>,
  accessToken: string
): Promise<{ status: number; data: GqlResponse<T> | undefined }> {
  await rateLimitWait();

  try {
    const response = await axios.post<GqlResponse<T>>(
      ANILIST_GRAPHQL_URL,
      { query, variables },
      {
        timeout: TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    // Authenticated traffic shares the anonymous client's adaptive limiter/cooldown.
    noteAniListRateHeaders(response.headers);
    return { status: response.status, data: response.data };
  } catch (error) {
    if (error instanceof AxiosError && error.response) {
      noteAniListRateHeaders(error.response.headers);
      if (error.response.status === 429) {
        throw noteAniListRateLimited(error.response.headers);
      }
      return { status: error.response.status, data: error.response.data as GqlResponse<T> | undefined };
    }
    throw error;
  }
}

export async function gqlRequestAuthenticated<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const { accessToken } = await getValidAccessToken();
  const first = await performRequest<T>(query, variables, accessToken);

  if (first.status !== 401) {
    return processResult<T>(first);
  }

  // Retry once after a forced refresh
  let refreshed: { accessToken: string };
  try {
    refreshed = await getValidAccessToken({ forceRefresh: true });
  } catch (error) {
    if (error instanceof AniListReauthRequiredError) throw error;
    throw error;
  }

  const second = await performRequest<T>(query, variables, refreshed.accessToken);
  if (second.status === 401) {
    await clearAniListTokens();
    throw new AniListReauthRequiredError('AniList rejected refreshed token');
  }
  return processResult<T>(second);
}

function processResult<T>(result: { status: number; data: GqlResponse<T> | undefined }): T {
  if (!result.data) {
    throw new Error(`AniList returned no body (status ${result.status})`);
  }
  // AniList sometimes signals 429 in the GraphQL body on an HTTP 200.
  if (result.data.errors?.some((error) => error.status === 429)) {
    throw noteAniListRateLimited({});
  }
  if (result.status >= 400) {
    const message = result.data.errors?.map((error) => error.message).join('; ');
    throw new Error(message ? `AniList API error: ${message}` : `AniList API error: ${result.status}`);
  }
  if (result.data.errors?.length) {
    const message = result.data.errors.map((error) => error.message).join('; ');
    throw new Error(`AniList API error: ${message}`);
  }
  return result.data.data;
}
