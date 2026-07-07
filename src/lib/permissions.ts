import type { User } from '@prisma/client';
import { CAPABILITIES, isCapability, type Capability } from '@/lib/capabilities';

// ─────────────────────────────────────────────────────────────────────────────
// Permission resolution.
//
// Two code-defined templates (admin / member) provide the base, and each user
// stores a small JSON map of DELTAS from their template (so rows stay tiny and
// "reset to template" is just clearing the map). Resolution is fail-closed:
// a capability with no override and no template default is denied. Admins
// short-circuit to allow-all so they can never lock themselves out.
// ─────────────────────────────────────────────────────────────────────────────

export type TemplateName = 'admin' | 'member';
export type CapabilityMap = Partial<Record<Capability, boolean>>;

// Capabilities a Member holds by default. Everything else is false for members,
// including any capability added in the future — new powers are opt-in, never
// granted retroactively to existing members.
const MEMBER_ALLOWED: readonly Capability[] = [
  // Library — read everything that isn't an admin subsystem.
  'dashboard.view',
  // Members manage their OWN dashboard layouts (per-user; never the admin's).
  'dashboard.customize',
  'discover.view',
  'anime.view',
  'movies.view',
  'series.view',
  'music.view',
  'watchlist.view',
  'watchlist.edit',
  'scheduledAlerts.view',
  'scheduledAlerts.edit',
  'random.view',
  'calendar.view',
  // Requests — view + create their own; approval stays with admins.
  'requests.view',
  'requests.create',
  // Torrents — members get no access at all: the qBittorrent list can include
  // downloads unrelated to the media library (privacy risk), so the page,
  // widgets, API, and notifications are all admin-only.
  // Jellyfin — view + toggle their OWN watch state (their own JF account; benign).
  // Server control (scan / restart / shutdown / scheduled tasks), sessions, and
  // stats are all admin.
  'jellyfin.view',
  'jellyfin.watchedState',
  // Activity — read-only.
  'activity.view',
  // Notifications — own history + the non-admin event channels.
  'notifications.view',
  'notify.media',
  'notify.jellyfin',
  'notify.watchlist',
  'notify.scheduled',
  'notify.requests',
  'notify.digests',
  // Settings — personal-facing pages only; global/infra settings are admin.
  'settings.account',
  'settings.sessions',
  'settings.notifications',
  'settings.appearance',
  'settings.preferences',
];

const MEMBER_ALLOWED_SET = new Set<string>(MEMBER_ALLOWED);

function buildTemplate(allowAll: boolean): Record<Capability, boolean> {
  const map = {} as Record<Capability, boolean>;
  for (const cap of CAPABILITIES) {
    map[cap] = allowAll ? true : MEMBER_ALLOWED_SET.has(cap);
  }
  return map;
}

export const ADMIN_TEMPLATE: Record<Capability, boolean> = buildTemplate(true);
export const MEMBER_TEMPLATE: Record<Capability, boolean> = buildTemplate(false);

function normalizeTemplate(template: string): TemplateName {
  return template === 'admin' ? 'admin' : 'member';
}

/** The template's default for a capability, before per-user overrides. */
export function templateDefault(template: string, cap: Capability): boolean {
  return normalizeTemplate(template) === 'admin' ? true : MEMBER_ALLOWED_SET.has(cap);
}

/** Parse the stored permissions JSON into a typed, validated delta map. */
export function parsePermissions(value: unknown): CapabilityMap {
  if (!value || typeof value !== 'object') return {};
  const out: CapabilityMap = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === 'boolean' && isCapability(key)) {
      out[key] = val;
    }
  }
  return out;
}

export type PermissionUser = Pick<User, 'role' | 'template' | 'permissions'>;

/**
 * Whether `user` may perform `cap`. Admins always can. Otherwise: a per-user
 * override wins; failing that, the template default; failing that, deny.
 */
export function can(user: PermissionUser, cap: Capability): boolean {
  if (user.role === 'admin') return true;
  const overrides = parsePermissions(user.permissions);
  const override = overrides[cap];
  if (typeof override === 'boolean') return override;
  return templateDefault(user.template, cap);
}

/** The fully-resolved capability map for a user (used by GET /api/me). */
export function effectiveCapabilities(user: PermissionUser): Record<Capability, boolean> {
  const out = {} as Record<Capability, boolean>;
  for (const cap of CAPABILITIES) {
    out[cap] = can(user, cap);
  }
  return out;
}

/**
 * Reduce a desired full/partial capability map down to only the entries that
 * differ from the template — what actually gets persisted to User.permissions.
 */
export function deltaFromTemplate(template: string, desired: CapabilityMap): CapabilityMap {
  const out: CapabilityMap = {};
  for (const cap of CAPABILITIES) {
    const want = desired[cap];
    if (typeof want === 'boolean' && want !== templateDefault(template, cap)) {
      out[cap] = want;
    }
  }
  return out;
}
