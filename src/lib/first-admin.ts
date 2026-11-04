import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { attachOwnerlessRowsToAdmin, BOOTSTRAP_ADMIN_ID } from '@/lib/bootstrap-admin';
import { hashPassword } from '@/lib/password';
import { localPasswordValidationError } from '@/lib/password-policy';
import { localUsernameValidationError, normalizeLocalUsername } from '@/lib/username-policy';
import { parseBareOrigin } from '@/lib/request-utils';
import { isLocalHostname } from '@/lib/local-hostname';

/**
 * Creating the first admin in the browser, as Jellyfin and Immich do.
 *
 * The screen is open only while there is no user at all and APP_PASSWORD is not
 * set (APP_PASSWORD keeps creating the admin at boot, for scripted installs). It
 * is never keyed on the bootstrap row or a missing password hash: an install whose
 * only admin signs in with Jellyfin, or whose bootstrap admin was deleted, must
 * never reopen it.
 */
// Once any user exists no app path empties the table again, so the answer stays
// "no" for the life of the process, and the public routes stop counting.
let firstAdminDone = false;

export async function needsFirstAdmin(): Promise<boolean> {
  if (process.env.APP_PASSWORD || firstAdminDone) return false;
  if ((await prisma.user.count()) > 0) {
    firstAdminDone = true;
    return false;
  }
  return true;
}

/** For tests that empty the User table between cases. */
export function resetFirstAdminLatch(): void {
  firstAdminDone = false;
}

// A public endpoint that hashes a password: at most this many claims a minute per
// process. The per-IP sign-in limit needs a trusted proxy, so it may not apply here.
const CLAIMS_PER_MINUTE = 10;
const claimTimes: number[] = [];

/** Whether another claim may run now; records it when it may. */
// A monotonic clock: a wall-clock step back would hold old entries "in the future".
export function takeClaimSlot(now = performance.now()): boolean {
  while (claimTimes.length > 0 && now - claimTimes[0] > 60_000) claimTimes.shift();
  if (claimTimes.length >= CLAIMS_PER_MINUTE) return false;
  claimTimes.push(now);
  return true;
}

/** For tests. */
export function resetClaimSlots(): void {
  claimTimes.length = 0;
}

export class FirstAdminTakenError extends Error {
  constructor() {
    super('An admin already exists');
    this.name = 'FirstAdminTakenError';
  }
}

export class FirstAdminInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirstAdminInputError';
  }
}

/**
 * Creates the first admin, once. The row takes the fixed bootstrap id, so of two
 * claims racing past the empty-table check only one insert can succeed; the other
 * hits the primary key and is told an admin already exists.
 */
export async function claimFirstAdmin(input: { username: unknown; password: unknown }): Promise<{ id: string; role: 'admin' }> {
  if (typeof input.username !== 'string') throw new FirstAdminInputError('Username is required');
  const usernameError = localUsernameValidationError(input.username);
  if (usernameError) throw new FirstAdminInputError(usernameError);
  const username = normalizeLocalUsername(input.username);
  if (typeof input.password !== 'string') throw new FirstAdminInputError('Password is required');
  const passwordError = localPasswordValidationError(input.password);
  if (passwordError) throw new FirstAdminInputError(passwordError);

  if (!(await needsFirstAdmin())) throw new FirstAdminTakenError();
  const passwordHash = await hashPassword(input.password);
  try {
    await prisma.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) throw new FirstAdminTakenError();
      await tx.user.create({
        data: {
          id: BOOTSTRAP_ADMIN_ID,
          username,
          displayName: 'Admin',
          passwordHash,
          role: 'admin',
          status: 'active',
          template: 'admin',
        },
      });
    });
  } catch (error) {
    if (error instanceof FirstAdminTakenError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new FirstAdminTakenError();
    }
    throw error;
  }
  firstAdminDone = true;
  console.log(`[Helprr] First admin created in the browser (username: ${username})`);
  await attachOwnerlessRowsToAdmin();
  return { id: BOOTSTRAP_ADMIN_ID, role: 'admin' };
}

// The local-address rule lives in its own module so client code can use it too.
export { isLocalHostname } from '@/lib/local-hostname';

/**
 * Whether a claim comes from Helprr's own page, at an address that cannot be a
 * rebound one. The claim needs no cookie, so a page on another site could otherwise
 * post it from a visitor's browser, and a DNS-rebinding page looks same-origin.
 * - With APP_ORIGIN set, the request must come from exactly that origin, which
 *   also works behind a reverse proxy that rewrites Host.
 * - Without it, the page must be at a local address and its origin must match Host.
 */
export function isAllowedSetupOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) {
    // Parsed as strictly as the OAuth path: an invalid APP_ORIGIN accepts nothing.
    const expected = parseBareOrigin(configured, false);
    return expected !== null && expected === parsed.origin;
  }
  const host = request.headers.get('host');
  return Boolean(host) && parsed.host === host && isLocalHostname(parsed.hostname);
}
