import { ADMIN_ONLY_EVENT_TYPES, EVENT_TYPE_TO_CAPABILITY } from '@/lib/capabilities';
import { EVENT_TYPES, type NotificationEventType } from '@/lib/notification-events';
import { can } from '@/lib/permissions';

// Request parsing shared by the channel routes and the settings import.

type ChannelOwner = Parameters<typeof can>[0] & { role: string };

/** The event types this user receives at all: a channel can only pick from these. */
export function receivableEventTypes(user: ChannelOwner): NotificationEventType[] {
  return EVENT_TYPES.filter((type) =>
    (!ADMIN_ONLY_EVENT_TYPES.has(type) || user.role === 'admin') && can(user, EVENT_TYPE_TO_CAPABILITY[type]));
}

/** The requested events the user may receive, deduplicated; null when the value is not a list. */
export function parseChannelEvents(user: ChannelOwner, value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const allowed = new Set<string>(receivableEventTypes(user));
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && allowed.has(item)))];
}

const MAX_NAME_LENGTH = 60;

/** A trimmed display name, or null when empty, too long, or holding control characters. */
export function parseChannelName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  if ([...name].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return null;
  return name;
}
