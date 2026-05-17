import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { invalidateLayoutCache, type DashboardDevice } from '@/lib/cache/dashboard-layout-cache';
import { DEFAULT_LAYOUT } from '@/lib/widgets/registry';
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
  createdAt: Date;
  updatedAt: Date;
}): DashboardLayoutRecord {
  return {
    id: row.id,
    name: row.name,
    widgets: Array.isArray(row.widgets) ? (row.widgets as WidgetInstance[]) : [],
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
    const widgets = sanitizeDashboardLayout(
      DEFAULT_LAYOUT.map((w) => ({ ...w })),
      discoverLayout,
    );
    const widgetsJson = widgets as unknown as Prisma.InputJsonValue;

    // Existence check inside the transaction so the count + creates form one
    // atomic unit. Without this, two replicas could both pass the check and
    // try to create — saved by `name @unique` today, but checking inside the
    // tx keeps the contract explicit.
    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.dashboardLayout.count();
      if (existing > 0) return false;

      const desktopRow = await tx.dashboardLayout.create({
        data: { name: 'Desktop', widgets: widgetsJson },
      });
      const mobileRow = await tx.dashboardLayout.create({
        data: { name: 'Mobile', widgets: widgetsJson },
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

    if (created) await invalidateLayoutCache();
  })().catch((error) => {
    seedPromise = null;
    throw error;
  });
  return seedPromise;
}

export async function listLayouts(): Promise<LayoutListResponse> {
  const [rows, settings] = await Promise.all([
    prisma.dashboardLayout.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { defaultDesktopLayoutId: true, defaultMobileLayoutId: true },
    }),
  ]);

  return {
    layouts: rows.map(rowToRecord),
    defaultDesktopLayoutId: settings?.defaultDesktopLayoutId ?? null,
    defaultMobileLayoutId: settings?.defaultMobileLayoutId ?? null,
  };
}

export async function createLayout(input: { name: unknown; widgets: unknown }): Promise<DashboardLayoutRecord> {
  const count = await prisma.dashboardLayout.count();
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
): Promise<DashboardLayoutRecord> {
  const existing = await prisma.dashboardLayout.findUnique({ where: { id } });
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

export async function copyLayout(id: string): Promise<DashboardLayoutRecord> {
  const source = await prisma.dashboardLayout.findUnique({ where: { id } });
  if (!source) throw new ServiceError('Layout not found', 404);

  const count = await prisma.dashboardLayout.count();
  if (count >= MAX_LAYOUTS) {
    throw new ServiceError(`Maximum of ${MAX_LAYOUTS} layouts reached`, 400);
  }

  const existingNames = new Set(
    (await prisma.dashboardLayout.findMany({ select: { name: true } })).map((r) => r.name),
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

export async function deleteLayout(id: string): Promise<void> {
  const settings = await prisma.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { defaultDesktopLayoutId: true, defaultMobileLayoutId: true },
  });
  if (settings?.defaultDesktopLayoutId === id || settings?.defaultMobileLayoutId === id) {
    throw new ServiceError(
      'Cannot delete a layout that is currently set as a device default. Pick a different default first.',
      400,
    );
  }
  const existing = await prisma.dashboardLayout.findUnique({ where: { id } });
  if (!existing) throw new ServiceError('Layout not found', 404);

  await prisma.dashboardLayout.delete({ where: { id } });
  await invalidateLayoutCache();
}

export async function setDefaultForDevice(layoutId: string, device: DashboardDevice): Promise<void> {
  const existing = await prisma.dashboardLayout.findUnique({ where: { id: layoutId } });
  if (!existing) throw new ServiceError('Layout not found', 404);

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
