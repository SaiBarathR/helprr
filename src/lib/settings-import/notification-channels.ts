// The notification channels of one imported account.

import type { Prisma } from '@prisma/client';
import type { ExportedNotificationChannel } from '@/lib/settings-export';
import { isChannelType, MAX_CHANNELS_PER_USER } from '@/lib/notification-channels/catalog';
import { decryptSecrets, encryptSecrets, toFieldMap, validateChannelInput } from '@/lib/notification-channels/config';
import { parseChannelEvents, parseChannelName } from '@/lib/notification-channels/requests';

/**
 * Create or update the account's channels by name. A file without secrets
 * keeps the ones already saved on this install for the same address; a channel
 * that would then lack a required secret is skipped, to be set up again.
 * Events are cut down to what the account may receive here.
 */
export async function applyUserNotificationChannelsInTxn(
  tx: Prisma.TransactionClient,
  channels: ExportedNotificationChannel[],
  userId: string,
  ownerLabel: string,
  skipped: string[],
): Promise<number> {
  const owner = await tx.user.findUnique({
    where: { id: userId },
    select: { role: true, permissions: true, template: true },
  });
  if (!owner) return 0;
  let applied = 0;
  for (const channel of channels.slice(0, MAX_CHANNELS_PER_USER)) {
    // (The file's own list is capped too, so a long one cannot multiply the writes.)
    if (!channel || typeof channel !== 'object') continue;
    const name = parseChannelName(channel.name);
    if (!isChannelType(channel.type) || !name) {
      skipped.push(`${ownerLabel}: a notification channel with an unknown type or no name`);
      continue;
    }
    const existing = await tx.notificationChannel.findUnique({ where: { userId_name: { userId, name } } });
    const sameType = existing?.type === channel.type;
    if (!existing && await tx.notificationChannel.count({ where: { userId } }) >= MAX_CHANNELS_PER_USER) {
      skipped.push(`${ownerLabel}: notification channel "${name}" skipped (already ${MAX_CHANNELS_PER_USER} channels)`);
      continue;
    }
    const input = validateChannelInput(channel.type, channel.config, channel.secrets ?? {}, {
      allowPrivate: owner.role === 'admin',
      existing: existing && sameType
        ? { config: toFieldMap(existing.config), secrets: decryptSecrets(existing.secrets) ?? {} }
        : undefined,
    });
    if (!input.ok) {
      skipped.push(`${ownerLabel}: notification channel "${name}" skipped (${input.error}) — set it up again in Settings → Notifications`);
      continue;
    }
    const data = {
      type: channel.type,
      enabled: channel.enabled !== false,
      events: parseChannelEvents(owner, channel.events) ?? [],
      config: input.config,
      secrets: encryptSecrets(input.secrets),
      consecutiveFailures: 0,
      lastFailedAt: null,
      lastError: null,
    };
    await tx.notificationChannel.upsert({
      where: { userId_name: { userId, name } },
      update: data,
      create: { userId, name, ...data },
    });
    applied += 1;
  }
  return applied;
}
