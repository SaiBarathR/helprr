// Prowlarr: its own health warnings (failing indexers, app sync, proxies) as notifications.
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { getProwlarrClient } from '@/lib/service-helpers';
import { ConfigurationError } from '@/lib/config-error';
import { getDefaultConnection } from '@/lib/arr-instances';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import { redactProwlarrText } from '@/lib/prowlarr-redact';
import { notifyAndLog } from './shared';

export async function pollProwlarr() {
  let client;
  try {
    client = await getProwlarrClient();
  } catch (error) {
    if (!(error instanceof ConfigurationError)) noteJobFailure(error);
    logger.debug('Skipping Prowlarr poll because client is unavailable', { error }, { scope: 'polling' });
    return;
  }

  const connection = await getDefaultConnection('PROWLARR');
  if (!connection) return;

  const state = await prisma.pollingState.upsert({
    where: { serviceConnectionId: connection.id },
    update: {},
    create: { serviceConnectionId: connection.id },
  });

  let health;
  try {
    health = await client.getHealth();
  } catch (error) {
    noteJobFailure(error);
    logger.warn('Prowlarr health poll failed', error, { scope: 'polling' });
    return;
  }

  // Sorted, so the same warnings in another order are not a change.
  const messages = health.map((check) => redactProwlarrText(String(check.message ?? ''))).sort();
  const healthHash = crypto.createHash('md5').update(JSON.stringify(messages)).digest('hex');
  if (state.lastHealthHash && healthHash !== state.lastHealthHash && messages.length > 0) {
    const sent = await notifyAndLog({
      eventType: 'healthWarning',
      title: 'Prowlarr Health Warning',
      body: messages.join('; ').slice(0, 200),
      url: '/prowlarr',
      metadata: { source: 'prowlarr', redirect: '/prowlarr' },
      // updatedAt moves when the hash below is saved. If that save fails, the
      // next cycle repeats this key and the history row stops a second push; a
      // warning that clears and later returns still gets a new key.
      dedupeKey: `prowlarr-health:${state.updatedAt.toISOString()}:${healthHash}`,
    }, { service: 'prowlarr', instanceId: connection.id, reason: 'health-changed', healthCount: messages.length });
    // Not recorded (null): keep the old hash so the next cycle tries again.
    if (sent === null) return;
  }

  await prisma.pollingState.update({
    where: { serviceConnectionId: connection.id },
    data: { lastHealthHash: healthHash },
  });
}
