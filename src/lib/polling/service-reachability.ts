// Every connected service: notify when it goes down or comes back.
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import { probeServiceHealth, SERVICE_LABELS } from '@/lib/service-health';
import { errorMessage, notifyAndLog } from './shared';

// Probes every configured service connection and fires a push when one
// transitions up→down (serviceDown) or down→up (serviceRestored). State lives
// in PollingState.lastReachable, mirroring the lastHealthHash transition
// pattern. The first probe of a connection only records a baseline (no alert),
// so a server restart while a service is down doesn't re-spam the down alert.
export async function pollServiceReachability(): Promise<void> {
  const connections = await prisma.serviceConnection.findMany();
  if (connections.length === 0) return;

  const states = await prisma.pollingState.findMany({
    where: { serviceConnectionId: { in: connections.map((c) => c.id) } },
    select: { serviceConnectionId: true, lastReachable: true },
  });
  const prevReachable = new Map(states.map((s) => [s.serviceConnectionId, s.lastReachable]));

  await Promise.all(
    connections.map(async (connection) => {
      try {
        const { ok, error } = await probeServiceHealth(connection);
        const prev = prevReachable.get(connection.id) ?? null;
        const serviceName = SERVICE_LABELS[connection.type] ?? connection.type;

        if (prev !== null && prev !== ok) {
          // Isolate notify failures: the lastReachable write below must always
          // run, or we'd re-detect the same transition and re-alert next cycle.
          try {
            if (!ok) {
              await notifyAndLog({
                eventType: 'serviceDown',
                title: `${serviceName} is unreachable`,
                body: (error ? `${connection.label}: ${error}` : `${connection.label} is not responding`).slice(0, 200),
                url: '/settings/status',
                metadata: { source: 'service-health', id: connection.id, redirect: '/settings/status' },
              }, { service: 'reachability', instanceId: connection.id, reason: 'service-down' });
            } else {
              await notifyAndLog({
                eventType: 'serviceRestored',
                title: `${serviceName} is back online`,
                body: `${connection.label} is responding again`,
                url: '/settings/status',
                metadata: { source: 'service-health', id: connection.id, redirect: '/settings/status' },
              }, { service: 'reachability', instanceId: connection.id, reason: 'service-restored' });
            }
          } catch (notifyError) {
            logger.warn('Service reachability notify failed', {
              instanceId: connection.id,
              error: errorMessage(notifyError),
            }, { scope: 'polling' });
          }
        }

        // Deliberately no lastQueueIds here: the queue baseline (and the
        // first-run detection built on it) belongs to the queue pollers.
        await prisma.pollingState.upsert({
          where: { serviceConnectionId: connection.id },
          update: { lastReachable: ok },
          create: { serviceConnectionId: connection.id, lastReachable: ok },
        });
      } catch (error) {
        noteJobFailure(error);
        logger.debug('Reachability probe failed unexpectedly', {
          instanceId: connection.id,
          error: errorMessage(error),
        }, { scope: 'polling' });
      }
    })
  );
}
