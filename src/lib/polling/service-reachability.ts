// Every connected service: notify when it goes down or comes back.
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import { DEFAULT_SERVICE_DOWN_ALERT_DELAY_SECS } from '@/lib/service-down-alert-delay';
import { probeServiceHealth, SERVICE_LABELS } from '@/lib/service-health';
import { errorMessage, notifyAndLog, type CycleContext } from './shared';

// When each connection's current run of failed probes began, while its "down"
// alert waits for AppSettings.serviceDownAlertDelaySecs. In memory on purpose:
// after a restart the wait starts again, which only delays an alert.
const failingSince = new Map<string, number>();

/** For tests: forget the pending failures. */
export function resetReachabilityTracking(): void {
  failingSince.clear();
}

// Probes every configured service connection and fires a push when one
// transitions up→down (serviceDown) or down→up (serviceRestored). State lives
// in PollingState.lastReachable, mirroring the lastHealthHash transition
// pattern. The first probe of a connection only records a baseline (no alert),
// so a server restart while a service is down doesn't re-spam the down alert.
//
// lastReachable is the state the alerts last reported. A service stays "up"
// there until it has failed every probe for the configured delay, so a short
// blip (a router or internet hiccup) sends neither alert, and "back online"
// only follows a "down" alert that was sent.
export async function pollServiceReachability(context: CycleContext): Promise<void> {
  const connections = await prisma.serviceConnection.findMany();
  const ids = new Set(connections.map((c) => c.id));
  for (const id of failingSince.keys()) if (!ids.has(id)) failingSince.delete(id);
  if (connections.length === 0) return;

  const settings = await context.getSettings();
  const delayMs = (settings.serviceDownAlertDelaySecs ?? DEFAULT_SERVICE_DOWN_ALERT_DELAY_SECS) * 1000;
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

        // What this probe means for the reported state: a failure while the
        // service is reported up only counts once it has lasted the delay.
        let reachable = ok;
        if (ok || prev !== true) {
          failingSince.delete(connection.id);
        } else {
          const now = Date.now();
          const since = failingSince.get(connection.id) ?? now;
          if (now - since >= delayMs) {
            failingSince.delete(connection.id);
          } else {
            failingSince.set(connection.id, since);
            reachable = true;
          }
        }

        if (prev !== null && prev !== reachable) {
          // Isolate notify failures: the lastReachable write below must always
          // run, or we'd re-detect the same transition and re-alert next cycle.
          try {
            if (!reachable) {
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
          update: { lastReachable: reachable },
          create: { serviceConnectionId: connection.id, lastReachable: reachable },
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
