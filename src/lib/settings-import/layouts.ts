// Dashboard layout sections (global and per user) of a settings import.

import type { Prisma } from '@prisma/client';
import type { ExportedDashboardLayout, ExportedDashboardLayouts } from '@/lib/settings-export';
import { validateDiscoverLayout, reconcileDiscoverLayout } from '@/lib/discover-layout-config';
import {
  MAX_LAYOUTS,
  MAX_NAME_LENGTH as MAX_LAYOUT_NAME_LENGTH,
  MAX_WIDGETS_PER_LAYOUT,
} from '@/lib/dashboard-layouts';
import { sanitizeDashboardLayout } from '@/lib/widgets/sanitize';
import type { WidgetInstance } from '@/lib/widgets/types';

export function validateLayoutWidgets(widgets: unknown): WidgetInstance[] | null {
  if (!Array.isArray(widgets)) return null;
  if (widgets.length > MAX_WIDGETS_PER_LAYOUT) return null;
  for (const w of widgets) {
    if (!w || typeof w !== 'object') return null;
    const item = w as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.widgetId !== 'string') return null;
  }
  return widgets as WidgetInstance[];
}

export async function applyDashboardLayoutsInTxn(
  tx: Prisma.TransactionClient,
  data: ExportedDashboardLayouts,
  skipped: string[],
): Promise<number> {
  if (!Array.isArray(data.layouts)) {
    skipped.push('Dashboard layouts: missing layouts array');
    return 0;
  }

  // Read the current discoverLayout once so widget sanitization can resolve
  // dynamic `discover-*` widgets.
  const settingsRow = await tx.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { discoverLayout: true },
  });
  const rawDiscover = settingsRow?.discoverLayout as unknown;
  const validatedDiscover = rawDiscover ? validateDiscoverLayout(rawDiscover) : null;
  const discoverLayout = reconcileDiscoverLayout(validatedDiscover);

  // Stage 1: upsert built-ins by slug (preserve existing IDs so anything
  // referencing them keeps working).
  // Stage 2: upsert user layouts by unique name.
  // We don't delete existing user layouts that aren't in the import — that's
  // less destructive and matches how appSettings/serviceConnections behave.
  const builtIns = data.layouts.filter(
    (l) => l && (l.slug === 'desktop' || l.slug === 'mobile'),
  );
  const userLayouts = data.layouts.filter(
    (l) => l && !(l.slug === 'desktop' || l.slug === 'mobile'),
  );

  let applied = 0;

  for (const layout of builtIns) {
    const widgets = validateLayoutWidgets(layout.widgets);
    if (!widgets) {
      skipped.push(`Dashboard layout "${String(layout.name ?? layout.slug)}" skipped: invalid widgets`);
      continue;
    }
    const sanitized = sanitizeDashboardLayout(widgets, discoverLayout);
    const name = typeof layout.name === 'string' && layout.name.trim().length > 0
      ? layout.name.trim().slice(0, MAX_LAYOUT_NAME_LENGTH)
      : layout.slug === 'mobile' ? 'Mobile' : 'Desktop';
    const slug = layout.slug as 'desktop' | 'mobile';

    const existing = await tx.dashboardLayout.findUnique({ where: { slug } });
    if (existing) {
      // Update widgets; rename only if the new name is free (otherwise keep
      // the existing name to avoid a unique-constraint violation).
      const nameTaken = name !== existing.name
        ? await tx.dashboardLayout.findFirst({ where: { name, userId: null }, select: { id: true } })
        : null;
      await tx.dashboardLayout.update({
        where: { id: existing.id },
        data: {
          widgets: sanitized as unknown as Prisma.InputJsonValue,
          isBuiltIn: true,
          ...(nameTaken ? {} : { name }),
        },
      });
    } else {
      // No row with this slug yet — create one. If the desired name collides
      // with a user layout, fall back to the canonical name. Walk a counter
      // suffix until we land on something the unique(name) constraint will
      // accept, so a second import never blows up.
      let finalName = name;
      const nameTaken = await tx.dashboardLayout.findFirst({ where: { name, userId: null }, select: { id: true } });
      if (nameTaken) {
        const base = slug === 'mobile' ? 'Mobile (built-in)' : 'Desktop (built-in)';
        finalName = base;
        let suffix = 2;
        while (await tx.dashboardLayout.findFirst({ where: { name: finalName, userId: null }, select: { id: true } })) {
          finalName = `${base} ${suffix}`;
          suffix += 1;
        }
      }
      await tx.dashboardLayout.create({
        data: {
          name: finalName,
          slug,
          isBuiltIn: true,
          widgets: sanitized as unknown as Prisma.InputJsonValue,
        },
      });
    }
    applied += 1;
  }

  // Cap user-layout imports so we never blow past MAX_LAYOUTS.
  const builtInCount = await tx.dashboardLayout.count({ where: { isBuiltIn: true, userId: null } });
  const userCountBefore = await tx.dashboardLayout.count({ where: { isBuiltIn: false, userId: null } });
  const remainingSlots = Math.max(0, MAX_LAYOUTS - builtInCount - userCountBefore);

  let createdUser = 0;
  for (const layout of userLayouts) {
    if (typeof layout.name !== 'string' || layout.name.trim().length === 0) {
      skipped.push('Dashboard layout skipped: missing name');
      continue;
    }
    const name = layout.name.trim().slice(0, MAX_LAYOUT_NAME_LENGTH);
    const widgets = validateLayoutWidgets(layout.widgets);
    if (!widgets) {
      skipped.push(`Dashboard layout "${name}" skipped: invalid widgets`);
      continue;
    }
    const sanitized = sanitizeDashboardLayout(widgets, discoverLayout);
    const existing = await tx.dashboardLayout.findFirst({ where: { name, userId: null } });
    if (existing) {
      // Don't downgrade an existing built-in to a user layout — skip and warn.
      if (existing.isBuiltIn) {
        skipped.push(`Dashboard layout "${name}" skipped: collides with a built-in name`);
        continue;
      }
      await tx.dashboardLayout.update({
        where: { id: existing.id },
        data: { widgets: sanitized as unknown as Prisma.InputJsonValue },
      });
      applied += 1;
    } else {
      if (createdUser >= remainingSlots) {
        skipped.push(`Dashboard layout "${name}" skipped: max ${MAX_LAYOUTS} layouts reached`);
        continue;
      }
      await tx.dashboardLayout.create({
        data: {
          name,
          isBuiltIn: false,
          slug: null,
          widgets: sanitized as unknown as Prisma.InputJsonValue,
        },
      });
      applied += 1;
      createdUser += 1;
    }
  }

  // Resolve default-layout names back to IDs and persist on AppSettings.
  // Prefer slug lookup for built-ins so a user layout that happens to share
  // the built-in's name can't beat the actual built-in.
  const desktopName = typeof data.defaultDesktopLayoutName === 'string'
    ? data.defaultDesktopLayoutName.trim()
    : null;
  const mobileName = typeof data.defaultMobileLayoutName === 'string'
    ? data.defaultMobileLayoutName.trim()
    : null;
  const desktopBuiltIn = await tx.dashboardLayout.findUnique({ where: { slug: 'desktop' }, select: { id: true, name: true } });
  const mobileBuiltIn = await tx.dashboardLayout.findUnique({ where: { slug: 'mobile' }, select: { id: true, name: true } });
  // Match built-ins by slug FIRST (case-insensitive). If the imported name is
  // "Desktop"/"Mobile" — the canonical built-in name — and the local built-in
  // happens to have been renamed (or had its name suffixed away by the
  // collision logic above when a user layout already owned "Desktop"), the
  // name-only lookup would otherwise resolve to the user layout. That made
  // the wrong row get persisted as the default.
  const desktopRow = desktopName
    ? (desktopBuiltIn && (
          desktopName.toLowerCase() === 'desktop' ||
          desktopBuiltIn.name === desktopName
        )
        ? desktopBuiltIn
        : await tx.dashboardLayout.findFirst({ where: { name: desktopName, userId: null }, select: { id: true } }))
    : null;
  const mobileRow = mobileName
    ? (mobileBuiltIn && (
          mobileName.toLowerCase() === 'mobile' ||
          mobileBuiltIn.name === mobileName
        )
        ? mobileBuiltIn
        : await tx.dashboardLayout.findFirst({ where: { name: mobileName, userId: null }, select: { id: true } }))
    : null;
  if (desktopRow || mobileRow) {
    await tx.appSettings.upsert({
      where: { id: 'singleton' },
      update: {
        ...(desktopRow ? { defaultDesktopLayoutId: desktopRow.id } : {}),
        ...(mobileRow ? { defaultMobileLayoutId: mobileRow.id } : {}),
      },
      create: {
        id: 'singleton',
        defaultDesktopLayoutId: desktopRow?.id ?? null,
        defaultMobileLayoutId: mobileRow?.id ?? null,
      },
    });
  }
  if (desktopName && !desktopRow) {
    skipped.push(`Default desktop layout "${desktopName}" not found in import — left unchanged`);
  }
  if (mobileName && !mobileRow) {
    skipped.push(`Default mobile layout "${mobileName}" not found in import — left unchanged`);
  }

  return applied;
}

/**
 * Restore one user's personal dashboard layouts, upserting by the
 * (userId, name) unique key. Same widget validation/sanitization and
 * MAX_LAYOUTS cap as the global-layout import.
 */
export async function applyUserDashboardLayoutsInTxn(
  tx: Prisma.TransactionClient,
  layouts: unknown[],
  skipped: string[],
  ownerUserId: string,
  ownerLabel: string,
): Promise<number> {
  const settingsRow = await tx.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { discoverLayout: true },
  });
  const rawDiscover = settingsRow?.discoverLayout as unknown;
  const validatedDiscover = rawDiscover ? validateDiscoverLayout(rawDiscover) : null;
  const discoverLayout = reconcileDiscoverLayout(validatedDiscover);

  let applied = 0;
  let count = await tx.dashboardLayout.count({ where: { userId: ownerUserId } });
  for (const raw of layouts) {
    if (!raw || typeof raw !== 'object') continue;
    const layout = raw as Partial<ExportedDashboardLayout>;
    if (typeof layout.name !== 'string' || layout.name.trim().length === 0) {
      skipped.push(`${ownerLabel}: dashboard layout skipped (missing name)`);
      continue;
    }
    const name = layout.name.trim().slice(0, MAX_LAYOUT_NAME_LENGTH);
    const widgets = validateLayoutWidgets(layout.widgets);
    if (!widgets) {
      skipped.push(`${ownerLabel}: dashboard layout "${name}" skipped (invalid widgets)`);
      continue;
    }
    const sanitized = sanitizeDashboardLayout(widgets, discoverLayout);
    const existing = await tx.dashboardLayout.findFirst({
      where: { userId: ownerUserId, name },
      select: { id: true },
    });
    if (existing) {
      await tx.dashboardLayout.update({
        where: { id: existing.id },
        data: { widgets: sanitized as unknown as Prisma.InputJsonValue },
      });
    } else {
      if (count >= MAX_LAYOUTS) {
        skipped.push(`${ownerLabel}: dashboard layout "${name}" skipped (max ${MAX_LAYOUTS} layouts reached)`);
        continue;
      }
      await tx.dashboardLayout.create({
        data: {
          userId: ownerUserId,
          name,
          isBuiltIn: false,
          slug: null,
          widgets: sanitized as unknown as Prisma.InputJsonValue,
        },
      });
      count += 1;
    }
    applied += 1;
  }
  return applied;
}
