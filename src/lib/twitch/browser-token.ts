import axios from 'axios';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { refuseRedirectToAnotherHost } from '@/lib/redirect-guard';
import { notifyAndLog } from '@/lib/polling/shared';
import { decryptTwitchToken } from '@/lib/twitch/token-cipher';

const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const CHECK_EVERY_MS = 24 * 3_600_000;

/** True or false from Twitch; null when Twitch could not be asked. Downloads no media. */
export async function checkBrowserToken(token: string): Promise<boolean | null> {
  try {
    await axios.get(VALIDATE_URL, {
      headers: { Authorization: `OAuth ${token}` },
      timeout: 10_000,
      beforeRedirect: refuseRedirectToAnotherHost,
    });
    return true;
  } catch (error) {
    return axios.isAxiosError(error) && error.response?.status === 401 ? false : null;
  }
}

export async function checkStoredBrowserToken(
  settings: { browserAuthToken: string | null; browserAuthTokenCheckedAt: Date | null; browserAuthTokenValid: boolean | null },
  now: Date,
): Promise<void> {
  if (!settings.browserAuthToken) return;
  if (settings.browserAuthTokenCheckedAt && now.getTime() - settings.browserAuthTokenCheckedAt.getTime() < CHECK_EVERY_MS) return;

  const token = decryptTwitchToken(settings.browserAuthToken);
  const valid = token ? await checkBrowserToken(token) : false;
  if (valid === null) {
    logger.warn('Twitch browser token check could not reach Twitch', {}, { scope: 'polling' });
    return;
  }
  await prisma.twitchSettings.update({
    where: { id: 'singleton' },
    data: { browserAuthTokenValid: valid, browserAuthTokenCheckedAt: now },
  });
  if (!valid && settings.browserAuthTokenValid !== false) {
    await notifyAndLog({
      eventType: 'twitchWorkerIssue',
      title: 'Twitch browser token stopped working',
      body: 'Sub-only VODs and 1440p need a new token in Settings → Twitch.',
      url: '/settings/twitch',
      dedupeKey: `twitch-token-invalid-${now.toISOString().slice(0, 10)}`,
      metadata: { source: 'twitch', id: 'browser-token', redirect: '/settings/twitch' },
    }, { service: 'twitch', instanceId: 'browser-token', reason: 'token-invalid' });
  }
}
