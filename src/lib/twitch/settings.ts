import { prisma } from '@/lib/db';

export function getTwitchSettings() {
  return prisma.archiveSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
}
