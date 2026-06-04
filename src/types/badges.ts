// Nav badge counts. Kept dependency-free so both client (nav-config, provider)
// and server (polling, /api/badges) can import the types without pulling in
// Redis/Prisma.

export type BadgeArea = 'activity' | 'downloads' | 'requests' | 'notifications';

// `total` is the headline number (shown muted); `attention` is the subset that
// needs the user — when > 0 the badge turns red. For requests/notifications the
// two are equal (pending / unread are inherently actionable).
export interface BadgeSlice {
  total: number;
  attention: number;
}

export type BadgeCounts = Record<BadgeArea, BadgeSlice>;

export const EMPTY_BADGE_SLICE: BadgeSlice = { total: 0, attention: 0 };

export const EMPTY_BADGE_COUNTS: BadgeCounts = {
  activity: { ...EMPTY_BADGE_SLICE },
  downloads: { ...EMPTY_BADGE_SLICE },
  requests: { ...EMPTY_BADGE_SLICE },
  notifications: { ...EMPTY_BADGE_SLICE },
};
