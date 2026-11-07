import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userSettings: vi.fn(),
  appSettings: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    userSettings: { findUnique: mocks.userSettings },
    appSettings: { findUnique: mocks.appSettings, upsert: vi.fn() },
  },
}));

import { getUserTimeZone } from '@/lib/app-settings';

describe("a person's own time zone", () => {
  beforeEach(() => {
    mocks.appSettings.mockResolvedValue({ id: 'singleton', timeZone: 'Europe/London' });
  });

  it('is theirs when they chose one', async () => {
    mocks.userSettings.mockResolvedValue({ timeZone: 'Asia/Tokyo' });
    expect(await getUserTimeZone('u1')).toBe('Asia/Tokyo');
    expect(mocks.userSettings).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
  });

  it("is the server's for \"Same as the server\", no settings, or a zone this server does not know", async () => {
    for (const settings of [{ timeZone: null }, null, { timeZone: 'Mars/Olympus' }]) {
      mocks.userSettings.mockResolvedValue(settings);
      expect(await getUserTimeZone('u1')).toBe('Europe/London');
    }
  });
});
