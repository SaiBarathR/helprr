import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// The setup checklist against real PostgreSQL: what each step reads, and marks that
// race. Uses the disposable database of the settings import test:
//   SETTINGS_IMPORT_TEST_DATABASE_URL=postgresql://…/helprr_import_test npx vitest run setup-checklist.integration
const url = process.env.SETTINGS_IMPORT_TEST_DATABASE_URL;

describe.skipIf(!url)('setup checklist against PostgreSQL', () => {
  let prisma: PrismaClient;
  let checklist: typeof import('@/lib/setup-checklist');
  let adminId: string;

  const pushDevice = (userId: string, endpoint: string, revokedAt: Date | null = null) =>
    prisma.pushSubscription.create({ data: { userId, endpoint, p256dh: 'p', auth: 'a', revokedAt } });

  beforeAll(async () => {
    if (new URL(url!).pathname !== '/helprr_import_test') {
      throw new Error('SETTINGS_IMPORT_TEST_DATABASE_URL must name the database helprr_import_test');
    }
    vi.stubEnv('DATABASE_URL', url!);
    ({ prisma } = await import('@/lib/db'));
    checklist = await import('@/lib/setup-checklist');
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "User", "ServiceConnection" CASCADE');
    await prisma.appSettings.updateMany({ data: { lastDatabaseBackupAt: null } });
    adminId = (await prisma.user.create({ data: { username: 'owner', displayName: 'Owner', role: 'admin' } })).id;
  });
  afterAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "User", "ServiceConnection" CASCADE');
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  it('starts with nothing done on a new install', async () => {
    expect(await checklist.getSetupChecklist(adminId)).toEqual({
      hidden: false,
      done: { service: false, people: false, push: false, install: false, backup: false },
      skipped: [],
    });
  });

  it('reads services, people and this admin\'s live push devices from the database', async () => {
    await prisma.serviceConnection.create({ data: { type: 'SONARR', label: 'Sonarr', url: 'http://sonarr:8989', apiKey: 'k' } });
    const member = await prisma.user.create({ data: { username: 'kid', displayName: 'Kid' } });
    await pushDevice(member.id, 'https://web.push.apple.com/member');
    await pushDevice(adminId, 'https://web.push.apple.com/revoked', new Date());
    let state = await checklist.getSetupChecklist(adminId);
    expect(state.done).toMatchObject({ service: true, people: true, push: false, install: false });

    await pushDevice(adminId, 'https://fcm.googleapis.com/fcm/send/desktop');
    state = await checklist.getSetupChecklist(adminId);
    expect(state.done).toMatchObject({ push: true, install: false });

    // Safari on a Mac uses Apple's push service too: a push device is not a phone.
    await pushDevice(adminId, 'https://web.push.apple.com/mac-or-iphone');
    expect((await checklist.getSetupChecklist(adminId)).done.install).toBe(false);
  });

  it('keeps every mark when several arrive at once for a user with no settings yet', async () => {
    await Promise.all([
      ...Array.from({ length: 4 }, () => checklist.markSetupStepDone(adminId, 'backup')),
      checklist.markSetupStepDone(adminId, 'install'),
      checklist.markSetupStepDone(adminId, 'people'),
    ]);
    const stored = await prisma.userSettings.findUniqueOrThrow({ where: { userId: adminId } });
    expect([...new Set(stored.setupStepsDone)].sort()).toEqual(['backup', 'install', 'people']);
    // Marking the optional people step by hand is a skip, not a tick.
    expect(await checklist.getSetupChecklist(adminId)).toMatchObject({
      done: { people: false, install: true, backup: true },
      skipped: ['people'],
    });

    await checklist.markSetupStepDone(adminId, 'backup');
    const again = await prisma.userSettings.findUniqueOrThrow({ where: { userId: adminId } });
    expect(again.setupStepsDone).toHaveLength(stored.setupStepsDone.length);
  });

  it('hides once every required step is done, people or not', async () => {
    await prisma.serviceConnection.create({ data: { type: 'RADARR', label: 'Radarr', url: 'http://radarr:7878', apiKey: 'k' } });
    await pushDevice(adminId, 'https://web.push.apple.com/iphone');
    await checklist.markSetupStepDone(adminId, 'install');
    expect((await checklist.getSetupChecklist(adminId)).hidden).toBe(false);
    await checklist.markSetupStepDone(adminId, 'backup');
    const state = await checklist.getSetupChecklist(adminId);
    expect(state.done.people).toBe(false);
    expect(state.hidden).toBe(true);
  });

  it('stays hidden after it is dismissed, without touching the marks, until restored', async () => {
    await checklist.markSetupStepDone(adminId, 'install');
    await checklist.dismissSetupChecklist(adminId);
    const state = await checklist.getSetupChecklist(adminId);
    expect(state.hidden).toBe(true);
    expect(state.done.install).toBe(true);
    await checklist.restoreSetupChecklist(adminId);
    expect((await checklist.getSetupChecklist(adminId)).hidden).toBe(false);
  });

  it('ticks the backup for every admin once backup.sh has recorded a database backup', async () => {
    const other = await prisma.user.create({ data: { username: 'second', displayName: 'Second', role: 'admin' } });
    await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      update: { lastDatabaseBackupAt: new Date() },
      create: { id: 'singleton', lastDatabaseBackupAt: new Date() },
    });
    expect((await checklist.getSetupChecklist(adminId)).done.backup).toBe(true);
    expect((await checklist.getSetupChecklist(other.id)).done.backup).toBe(true);
  });

  it('keeps each admin\'s marks to themselves', async () => {
    const other = await prisma.user.create({ data: { username: 'second', displayName: 'Second', role: 'admin' } });
    await checklist.markSetupStepDone(adminId, 'backup');
    await checklist.dismissSetupChecklist(adminId);
    const state = await checklist.getSetupChecklist(other.id);
    expect(state.hidden).toBe(false);
    expect(state.done.backup).toBe(false);
  });
});
