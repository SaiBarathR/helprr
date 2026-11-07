import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  OPTIONAL_SETUP_STEPS,
  SETUP_STEPS,
  setupProgress,
  type SetupChecklistState,
  type SetupStep,
} from '@/lib/setup-checklist-steps';

/**
 * The admin's setup checklist on the dashboard: each step's state comes from the
 * server's own data where it can; the rest are marked done by the admin (the backup
 * also by scripts/backup.sh, which records each database backup it makes), or, for
 * an optional step, skipped.
 */
export * from '@/lib/setup-checklist-steps';

export async function getSetupChecklist(userId: string): Promise<SetupChecklistState> {
  const [settings, services, people, pushDevices, appSettings] = await Promise.all([
    prisma.userSettings.findUnique({
      where: { userId },
      select: { setupChecklistDismissedAt: true, setupStepsDone: true },
    }),
    prisma.serviceConnection.count(),
    prisma.user.count(),
    prisma.pushSubscription.count({ where: { userId, revokedAt: null } }),
    prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { lastDatabaseBackupAt: true } }),
  ]);
  const marked = new Set(settings?.setupStepsDone ?? []);
  const done: Record<SetupStep, boolean> = {
    service: services > 0,
    people: people > 1,
    push: pushDevices > 0,
    // The server cannot tell a phone from a Mac (Safari on macOS uses Apple's push
    // service too): opening Helprr as an installed app on a phone marks it instead.
    install: marked.has('install'),
    backup: marked.has('backup') || Boolean(appSettings?.lastDatabaseBackupAt),
  };
  // An optional step marked by hand was skipped ("Skip"), not done.
  const skipped = SETUP_STEPS.filter((step) => OPTIONAL_SETUP_STEPS.has(step) && !done[step] && marked.has(step));
  return { hidden: Boolean(settings?.setupChecklistDismissedAt) || setupProgress(done).complete, done, skipped };
}

// Two first writes for a user race on the unique userId: the loser updates instead.
async function upsertUserSettings(
  userId: string,
  create: Prisma.UserSettingsUncheckedCreateInput,
  update: Prisma.UserSettingsUpdateInput,
): Promise<void> {
  try {
    await prisma.userSettings.upsert({ where: { userId }, create, update });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    await prisma.userSettings.update({ where: { userId }, data: update });
  }
}

/**
 * Marks a step done for this user. Adding to the list is one statement, so two at once
 * never lose one; two at once may both add it, which is harmless (it is read as a set).
 */
export async function markSetupStepDone(userId: string, step: SetupStep): Promise<void> {
  const settings = await prisma.userSettings.findUnique({ where: { userId }, select: { setupStepsDone: true } });
  if (settings?.setupStepsDone.includes(step)) return;
  await upsertUserSettings(userId, { userId, setupStepsDone: [step] }, { setupStepsDone: { push: step } });
}

export async function dismissSetupChecklist(userId: string): Promise<void> {
  const now = new Date();
  await upsertUserSettings(userId, { userId, setupChecklistDismissedAt: now }, { setupChecklistDismissedAt: now });
}

/** Undoes a dismissal (the toast's Undo). */
export async function restoreSetupChecklist(userId: string): Promise<void> {
  await prisma.userSettings.updateMany({ where: { userId }, data: { setupChecklistDismissedAt: null } });
}
