import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  invalidateLayoutCache,
  getActiveLayoutCached,
  type DashboardDevice,
  type ActiveLayout,
} from '@/lib/cache/dashboard-layout-cache';
import {
  DEFAULT_DESKTOP_LAYOUT,
  DEFAULT_MOBILE_LAYOUT,
  DEFAULT_MEMBER_DESKTOP_LAYOUT,
  DEFAULT_MEMBER_MOBILE_LAYOUT,
  getDefaultLayoutForSlug,
  type DashboardLayoutSlug,
} from '@/lib/widgets/registry';

// Ownership scope for layout operations: `null` = the global/admin layouts
// (shared built-ins); a user id = that member's personal layouts.
export type LayoutScope = string | null;

/** Admins operate on the shared/global layouts (null); members on their own. */
export function layoutScopeForUser(user: { id: string; role: 'admin' | 'member' }): LayoutScope {
  return user.role === 'admin' ? null : user.id;
}
import { sanitizeDashboardLayout } from '@/lib/widgets/sanitize';
import type { WidgetInstance } from '@/lib/widgets/types';
import {
  reconcileDiscoverLayout,
  validateDiscoverLayout,
  type DiscoverLayoutConfig,
} from '@/lib/discover-layout-config';

export const MAX_LAYOUTS = 20;
export const MAX_NAME_LENGTH = 50;
export const MAX_WIDGETS_PER_LAYOUT = 200;

export interface DashboardLayoutRecord {
  id: string;
  name: string;
  widgets: WidgetInstance[];
  isBuiltIn: boolean;
  slug: DashboardLayoutSlug | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LayoutListResponse {
  layouts: DashboardLayoutRecord[];
  defaultDesktopLayoutId: string | null;
  defaultMobileLayoutId: string | null;
}

function rowToRecord(row: {
  id: string;
  name: string;
  widgets: unknown;
  isBuiltIn?: boolean;
  slug?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): DashboardLayoutRecord {
  const rawSlug = row.slug ?? null;
  const slug: DashboardLayoutSlug | null =
    rawSlug === 'desktop' || rawSlug === 'mobile' ? rawSlug : null;
  return {
    id: row.id,
    name: row.name,
    widgets: Array.isArray(row.widgets) ? (row.widgets as WidgetInstance[]) : [],
    isBuiltIn: row.isBuiltIn ?? false,
    slug,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getDiscoverLayout(): Promise<DiscoverLayoutConfig> {
  // Always reconcile so dynamic discover widgets (`discover-*`) resolve via
  // `getWidgetDefinition`. The raw DB value is often null on fresh installs,
  // but the client treats the absence the same as "default discover layout"
  // (see DiscoverLayoutHydrator). Sanitizing on the server with a raw null
  // would silently drop every discover widget the user added.
  const settings = await prisma.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { discoverLayout: true },
  });
  const raw = settings?.discoverLayout as unknown;
  const validated = raw ? validateDiscoverLayout(raw) : null;
  return reconcileDiscoverLayout(validated);
}

function validateName(name: unknown): string {
  if (typeof name !== 'string') throw new ServiceError('Name is required', 400);
  const trimmed = name.trim();
  if (!trimmed) throw new ServiceError('Name cannot be empty', 400);
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new ServiceError(`Name must be ${MAX_NAME_LENGTH} characters or fewer`, 400);
  }
  return trimmed;
}

function validateWidgets(widgets: unknown): WidgetInstance[] {
  if (!Array.isArray(widgets)) throw new ServiceError('Widgets must be an array', 400);
  if (widgets.length > MAX_WIDGETS_PER_LAYOUT) {
    throw new ServiceError(`Maximum of ${MAX_WIDGETS_PER_LAYOUT} widgets per layout`, 400);
  }
  // Basic shape check; full sanitization happens via sanitizeDashboardLayout below.
  for (const w of widgets) {
    if (!w || typeof w !== 'object') throw new ServiceError('Invalid widget entry', 400);
    const item = w as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.widgetId !== 'string') {
      throw new ServiceError('Widget entries require id and widgetId', 400);
    }
  }
  return widgets as WidgetInstance[];
}

export class ServiceError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === 'P2002'
  );
}

// Singleton promise so simultaneous callers (parallel page renders, parallel
// API hits on a cold install) share a single seed attempt. After the first
// successful resolve every subsequent call is a no-op cache hit. On failure we
// null the slot so the next call retries.
let seedPromise: Promise<void> | null = null;

export function seedInitialLayouts(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const discoverLayout = await getDiscoverLayout();
    const desktopWidgets = sanitizeDashboardLayout(
      DEFAULT_DESKTOP_LAYOUT.map((w) => ({ ...w })),
      discoverLayout,
    );
    const mobileWidgets = sanitizeDashboardLayout(
      DEFAULT_MOBILE_LAYOUT.map((w) => ({ ...w })),
      discoverLayout,
    );
    const desktopJson = desktopWidgets as unknown as Prisma.InputJsonValue;
    const mobileJson = mobileWidgets as unknown as Prisma.InputJsonValue;

    // Existence check inside the transaction so the count + creates form one
    // atomic unit. Without this, two replicas could both pass the check and
    // try to create — saved by `name @unique` today, but checking inside the
    // tx keeps the contract explicit.
    const changed = await prisma.$transaction(async (tx) => {
      // Scope to GLOBAL (admin) layouts — member-owned rows (userId set) must
      // not make the global built-in seed think it has already run.
      const existing = await tx.dashboardLayout.count({ where: { userId: null } });
      if (existing > 0) {
        // Backfill `isBuiltIn`/`slug` for installs that pre-date these
        // columns so the read-only lock + Built-in badge apply correctly.
        // Match the two seeded layouts by their original names; the
        // `slug: null` predicate makes the update idempotent on warm starts.
        const desktopUpdate = await tx.dashboardLayout.updateMany({
          where: { name: 'Desktop', slug: null, userId: null },
          data: { isBuiltIn: true, slug: 'desktop' },
        });
        const mobileUpdate = await tx.dashboardLayout.updateMany({
          where: { name: 'Mobile', slug: null, userId: null },
          data: { isBuiltIn: true, slug: 'mobile' },
        });
        return desktopUpdate.count > 0 || mobileUpdate.count > 0;
      }

      const desktopRow = await tx.dashboardLayout.create({
        data: { name: 'Desktop', widgets: desktopJson, isBuiltIn: true, slug: 'desktop', userId: null },
      });
      const mobileRow = await tx.dashboardLayout.create({
        data: { name: 'Mobile', widgets: mobileJson, isBuiltIn: true, slug: 'mobile', userId: null },
      });
      await tx.appSettings.upsert({
        where: { id: 'singleton' },
        update: {
          defaultDesktopLayoutId: desktopRow.id,
          defaultMobileLayoutId: mobileRow.id,
        },
        create: {
          id: 'singleton',
          defaultDesktopLayoutId: desktopRow.id,
          defaultMobileLayoutId: mobileRow.id,
        },
      });
      return true;
    });

    if (changed) {
      await invalidateLayoutCache();
    }
  })().catch((error) => {
    seedPromise = null;
    throw error;
  });
  return seedPromise;
}

export async function listLayouts(scope: LayoutScope): Promise<LayoutListResponse> {
  if (scope) await ensureMemberLayouts(scope);
  const rows = await prisma.dashboardLayout.findMany({
    where: { userId: scope },
    orderBy: { createdAt: 'asc' },
  });

  // Active-default pointers live on AppSettings for admins (scope=null) and on
  // the member's UserSettings otherwise.
  let defaultDesktopLayoutId: string | null = null;
  let defaultMobileLayoutId: string | null = null;
  if (scope) {
    const us = await prisma.userSettings.findUnique({
      where: { userId: scope },
      select: { defaultDesktopLayoutId: true, defaultMobileLayoutId: true },
    });
    defaultDesktopLayoutId = us?.defaultDesktopLayoutId ?? null;
    defaultMobileLayoutId = us?.defaultMobileLayoutId ?? null;
  } else {
    const settings = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { defaultDesktopLayoutId: true, defaultMobileLayoutId: true },
    });
    defaultDesktopLayoutId = settings?.defaultDesktopLayoutId ?? null;
    defaultMobileLayoutId = settings?.defaultMobileLayoutId ?? null;
  }

  return { layouts: rows.map(rowToRecord), defaultDesktopLayoutId, defaultMobileLayoutId };
}

export async function createLayout(
  input: { name: unknown; widgets: unknown },
  scope: LayoutScope,
): Promise<DashboardLayoutRecord> {
  const count = await prisma.dashboardLayout.count({ where: { userId: scope } });
  if (count >= MAX_LAYOUTS) {
    throw new ServiceError(`Maximum of ${MAX_LAYOUTS} layouts reached`, 400);
  }
  const name = validateName(input.name);
  const widgets = validateWidgets(input.widgets);
  const discoverLayout = await getDiscoverLayout();
  const sanitized = sanitizeDashboardLayout(widgets, discoverLayout);

  let row;
  try {
    row = await prisma.dashboardLayout.create({
      data: {
        userId: scope,
        name,
        widgets: sanitized as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ServiceError('A layout with that name already exists', 409);
    }
    throw error;
  }
  await invalidateLayoutCache();
  return rowToRecord(row);
}

export async function updateLayout(
  id: string,
  input: { name?: unknown; widgets?: unknown },
  scope: LayoutScope,
): Promise<DashboardLayoutRecord> {
  // Scope-bounded lookup enforces ownership: a member can only touch their own
  // layouts; an admin only the global ones.
  const existing = await prisma.dashboardLayout.findFirst({ where: { id, userId: scope } });
  if (!existing) throw new ServiceError('Layout not found', 404);

  const data: Prisma.DashboardLayoutUpdateInput = {};
  if (input.name !== undefined) {
    data.name = validateName(input.name);
  }
  if (input.widgets !== undefined) {
    const widgets = validateWidgets(input.widgets);
    const discoverLayout = await getDiscoverLayout();
    data.widgets = sanitizeDashboardLayout(widgets, discoverLayout) as unknown as Prisma.InputJsonValue;
  }

  let row;
  try {
    row = await prisma.dashboardLayout.update({ where: { id }, data });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ServiceError('A layout with that name already exists', 409);
    }
    throw error;
  }
  await invalidateLayoutCache();
  return rowToRecord(row);
}

export async function copyLayout(id: string, scope: LayoutScope): Promise<DashboardLayoutRecord> {
  const source = await prisma.dashboardLayout.findFirst({ where: { id, userId: scope } });
  if (!source) throw new ServiceError('Layout not found', 404);

  const count = await prisma.dashboardLayout.count({ where: { userId: scope } });
  if (count >= MAX_LAYOUTS) {
    throw new ServiceError(`Maximum of ${MAX_LAYOUTS} layouts reached`, 400);
  }

  const existingNames = new Set(
    (await prisma.dashboardLayout.findMany({ where: { userId: scope }, select: { name: true } })).map((r) => r.name),
  );
  // Trim the source name first so there is always room for the `_copy_NN`
  // suffix. Without this, a 49-character name would produce candidates that
  // all truncate to the same prefix and silently collide.
  const SUFFIX_BUDGET = 10;
  const baseRoot = source.name.slice(0, Math.max(1, MAX_NAME_LENGTH - SUFFIX_BUDGET));
  let candidate = `${baseRoot}_copy`;
  let attempt = 2;
  while (existingNames.has(candidate)) {
    candidate = `${baseRoot}_copy_${attempt}`;
    attempt += 1;
    if (attempt > 999) break;
  }
  if (candidate.length > MAX_NAME_LENGTH) {
    candidate = candidate.slice(0, MAX_NAME_LENGTH);
  }

  let row;
  try {
    row = await prisma.dashboardLayout.create({
      data: {
        userId: scope,
        name: candidate,
        widgets: source.widgets as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A concurrent copy raced us to the same generated name. Surface a clean
      // 409 — the caller can retry and our suffix-bump will pick the next free
      // candidate.
      throw new ServiceError('A layout with that name already exists', 409);
    }
    throw error;
  }
  await invalidateLayoutCache();
  return rowToRecord(row);
}

export async function deleteLayout(id: string, scope: LayoutScope): Promise<void> {
  const existing = await prisma.dashboardLayout.findFirst({ where: { id, userId: scope } });
  if (!existing) throw new ServiceError('Layout not found', 404);
  if (existing.isBuiltIn) {
    throw new ServiceError('Built-in layouts cannot be deleted. Use Reset to restore the default widgets.', 400);
  }
  // The active-default lives on AppSettings (admin) or the member's UserSettings.
  const defaults = scope
    ? await prisma.userSettings.findUnique({
        where: { userId: scope },
        select: { defaultDesktopLayoutId: true, defaultMobileLayoutId: true },
      })
    : await prisma.appSettings.findUnique({
        where: { id: 'singleton' },
        select: { defaultDesktopLayoutId: true, defaultMobileLayoutId: true },
      });
  if (defaults?.defaultDesktopLayoutId === id || defaults?.defaultMobileLayoutId === id) {
    throw new ServiceError(
      'Cannot delete a layout that is currently set as a device default. Pick a different default first.',
      400,
    );
  }

  await prisma.dashboardLayout.delete({ where: { id } });
  await invalidateLayoutCache();
}

export async function resetLayoutToDefault(id: string, scope: LayoutScope): Promise<DashboardLayoutRecord> {
  const existing = await prisma.dashboardLayout.findFirst({ where: { id, userId: scope } });
  if (!existing) throw new ServiceError('Layout not found', 404);
  if (!existing.isBuiltIn || (existing.slug !== 'desktop' && existing.slug !== 'mobile')) {
    throw new ServiceError('Only built-in layouts can be reset', 400);
  }

  const defaults = getDefaultLayoutForSlug(existing.slug as DashboardLayoutSlug);
  const discoverLayout = await getDiscoverLayout();
  const sanitized = sanitizeDashboardLayout(
    defaults.map((w) => ({ ...w })),
    discoverLayout,
  );

  const row = await prisma.dashboardLayout.update({
    where: { id },
    data: { widgets: sanitized as unknown as Prisma.InputJsonValue },
  });
  await invalidateLayoutCache();
  return rowToRecord(row);
}

export async function setDefaultForDevice(
  layoutId: string,
  device: DashboardDevice,
  scope: LayoutScope,
): Promise<void> {
  const existing = await prisma.dashboardLayout.findFirst({ where: { id: layoutId, userId: scope } });
  if (!existing) throw new ServiceError('Layout not found', 404);

  if (scope) {
    // Member: their own active-layout pointer on UserSettings.
    await prisma.userSettings.upsert({
      where: { userId: scope },
      update: device === 'desktop' ? { defaultDesktopLayoutId: layoutId } : { defaultMobileLayoutId: layoutId },
      create: {
        userId: scope,
        defaultDesktopLayoutId: device === 'desktop' ? layoutId : null,
        defaultMobileLayoutId: device === 'mobile' ? layoutId : null,
      },
    });
    await invalidateLayoutCache();
    return;
  }

  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: device === 'desktop'
      ? { defaultDesktopLayoutId: layoutId }
      : { defaultMobileLayoutId: layoutId },
    create: {
      id: 'singleton',
      defaultDesktopLayoutId: device === 'desktop' ? layoutId : null,
      defaultMobileLayoutId: device === 'mobile' ? layoutId : null,
    },
  });
  await invalidateLayoutCache();
}

/**
 * Seed a member their own starter layouts (Desktop + Mobile) from the member
 * default, and point their UserSettings at them. Idempotent: no-op once they
 * have any layout of their own. Concurrent first-loads are deduped by the
 * unique [userId, name] constraint (the loser's create is swallowed).
 */
export async function ensureMemberLayouts(userId: string): Promise<void> {
  const count = await prisma.dashboardLayout.count({ where: { userId } });
  if (count > 0) return;

  const discoverLayout = await getDiscoverLayout();
  const desktopWidgets = sanitizeDashboardLayout(
    DEFAULT_MEMBER_DESKTOP_LAYOUT.map((w) => ({ ...w })),
    discoverLayout,
  ) as unknown as Prisma.InputJsonValue;
  const mobileWidgets = sanitizeDashboardLayout(
    DEFAULT_MEMBER_MOBILE_LAYOUT.map((w) => ({ ...w })),
    discoverLayout,
  ) as unknown as Prisma.InputJsonValue;

  try {
    const desktopRow = await prisma.dashboardLayout.create({
      data: { userId, name: 'Desktop', widgets: desktopWidgets, isBuiltIn: false },
    });
    const mobileRow = await prisma.dashboardLayout.create({
      data: { userId, name: 'Mobile', widgets: mobileWidgets, isBuiltIn: false },
    });
    await prisma.userSettings.upsert({
      where: { userId },
      update: { defaultDesktopLayoutId: desktopRow.id, defaultMobileLayoutId: mobileRow.id },
      create: { userId, defaultDesktopLayoutId: desktopRow.id, defaultMobileLayoutId: mobileRow.id },
    });
  } catch (error) {
    // Another concurrent first-load already seeded them — fine.
    if (!isUniqueViolation(error)) throw error;
  }
}

/**
 * The active layout for a given user + device. Admins use the shared/global
 * pointers (cached); members use their own UserSettings pointer over their own
 * seeded layouts.
 */
export async function getActiveLayoutForUser(
  user: { id: string; role: 'admin' | 'member' },
  device: DashboardDevice,
): Promise<ActiveLayout | null> {
  if (user.role === 'admin') {
    return getActiveLayoutCached(device);
  }

  await ensureMemberLayouts(user.id);
  const us = await prisma.userSettings.findUnique({
    where: { userId: user.id },
    select: { defaultDesktopLayoutId: true, defaultMobileLayoutId: true },
  });
  const pointerId = device === 'desktop' ? us?.defaultDesktopLayoutId : us?.defaultMobileLayoutId;
  if (pointerId) {
    const row = await prisma.dashboardLayout.findFirst({
      where: { id: pointerId, userId: user.id },
      select: { id: true, name: true, widgets: true, isBuiltIn: true },
    });
    if (row) return row as ActiveLayout;
  }
  const fallback = await prisma.dashboardLayout.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, widgets: true, isBuiltIn: true },
  });
  return (fallback as ActiveLayout | null) ?? null;
}
