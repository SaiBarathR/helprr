import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { notifyEvent } from '@/lib/notification-service';

// Admin alerts (push and channels) raised from the security audit trail: an
// admin signing in on a browser not seen before, a burst of failed sign-ins,
// and two-step sign-in being turned off. They read rows recordSecurityEvent and
// recordFailedSignIn have just written, and are started without being awaited
// so a sign-in never waits on a push.

export const FAILED_SIGN_IN_WINDOW_MS = 10 * 60 * 1000;
export const FAILED_SIGN_IN_BURST = 10;
const AUDIT_PAGE = '/settings/file-audit';

function raise(event: Parameters<typeof notifyEvent>[0]): Promise<void> {
  return notifyEvent(event).then(() => undefined);
}

// How many of the admin's earlier sign-ins are compared against.
const KNOWN_DEVICE_LOOKBACK = 200;

/**
 * A user agent without its version numbers, so a browser or OS update does
 * not make a known device look new. A heuristic: the header is the client's
 * to set, so this catches a careless sign-in, not a careful one.
 */
export function deviceFamily(userAgent: string | null): string {
  return (userAgent ?? '').replace(/[\d_.]+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** After a LOGIN_SUCCEEDED row: alert when an admin signs in from a browser family their sign-ins never used. */
export async function alertOnNewDeviceSignIn(userId: string, userAgent: string | null, ip: string | null): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, username: true } });
  if (!user || user.role !== 'admin') return;
  const earlier = await prisma.securityAuditEvent.findMany({
    where: { action: 'LOGIN_SUCCEEDED', actorUserId: userId },
    select: { userAgent: true },
    orderBy: { createdAt: 'desc' },
    take: KNOWN_DEVICE_LOOKBACK,
  });
  // The row for this sign-in is already written, so a known device appears at least twice.
  const family = deviceFamily(userAgent);
  if (earlier.filter((row) => deviceFamily(row.userAgent) === family).length > 1) return;
  await raise({
    eventType: 'securityAlert',
    title: 'New sign-in to an admin account',
    body: `${user.username} signed in from a browser or device not seen before${ip ? ` (network ${ip})` : ''}.`,
    url: AUDIT_PAGE,
    // A tag of its own, so it does not replace another security alert on the device.
    metadata: { source: 'security', id: `new-device-${Date.now()}` },
  });
}

/** After a failed sign-in: alert once per window when the window holds a burst of them. */
export async function alertOnFailedSignInBurst(nowMs = Date.now()): Promise<void> {
  const since = new Date(nowMs - FAILED_SIGN_IN_WINDOW_MS);
  const total = await prisma.securityAuditEvent.aggregate({
    where: { action: 'LOGIN_FAILED', createdAt: { gte: since } },
    _sum: { count: true },
  });
  const failures = total._sum.count ?? 0;
  if (failures < FAILED_SIGN_IN_BURST) return;
  await raise({
    eventType: 'securityAlert',
    title: 'Many failed sign-ins',
    body: `${failures} failed sign-ins to Helprr in the last ${FAILED_SIGN_IN_WINDOW_MS / 60_000} minutes.`,
    url: AUDIT_PAGE,
    // One alert per window, however many more attempts follow.
    dedupeKey: `failedSignInBurst:${Math.floor(nowMs / FAILED_SIGN_IN_WINDOW_MS)}`,
    metadata: { source: 'security', id: `failed-sign-ins-${Math.floor(nowMs / FAILED_SIGN_IN_WINDOW_MS)}` },
  });
}

/** After an MFA_DISABLED row: whoever turned it off, for whichever account. */
export async function alertOnTwoStepDisabled(targetLabel: string | null, actorUsername: string | null): Promise<void> {
  const target = targetLabel || 'an account';
  const by = actorUsername && actorUsername !== targetLabel ? ` by ${actorUsername}` : '';
  await raise({
    eventType: 'securityAlert',
    title: 'Two-step sign-in turned off',
    body: `Two-step sign-in was turned off for ${target}${by}.`,
    url: AUDIT_PAGE,
    metadata: { source: 'security', id: `two-step-off-${Date.now()}` },
  });
}

/** Start an alert without waiting for it; a failure is logged, never thrown. */
export function startSecurityAlert(alert: () => Promise<void>): void {
  void alert().catch((error) => {
    logger.warn('Security alert could not be sent', {
      reason: error instanceof Error ? error.name : 'unknown',
    }, { scope: 'notifications' });
  });
}
