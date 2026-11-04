import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { attachOwnerlessRowsToAdmin, BOOTSTRAP_ADMIN_ID } from '@/lib/bootstrap-admin';
import { hashPassword } from '@/lib/password';
import { localPasswordValidationError } from '@/lib/password-policy';
import { localUsernameValidationError, normalizeLocalUsername } from '@/lib/username-policy';

/**
 * Creating the first admin in the browser, as Jellyfin and Immich do.
 *
 * The screen is open only while there is no user at all and APP_PASSWORD is not
 * set (APP_PASSWORD keeps creating the admin at boot, for scripted installs). It
 * is never keyed on the bootstrap row or a missing password hash: an install whose
 * only admin signs in with Jellyfin, or whose bootstrap admin was deleted, must
 * never reopen it.
 */
export async function needsFirstAdmin(): Promise<boolean> {
  if (process.env.APP_PASSWORD) return false;
  return (await prisma.user.count()) === 0;
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
  console.log(`[Helprr] First admin created in the browser (username: ${username})`);
  await attachOwnerlessRowsToAdmin();
  return { id: BOOTSTRAP_ADMIN_ID, role: 'admin' };
}

/**
 * Whether a request comes from Helprr's own pages. The claim needs no cookie, so
 * a page on another site could otherwise post it from a visitor's browser.
 */
export function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
