import { prisma } from '@/lib/db';

export function getTwitchSettings() {
  return prisma.twitchSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
}
