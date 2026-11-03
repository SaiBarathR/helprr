import { prisma } from '@/lib/db';

export function getYoutubeSettings() {
  return prisma.youtubeSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
}
