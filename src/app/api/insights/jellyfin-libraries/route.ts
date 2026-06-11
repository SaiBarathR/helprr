import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import type { JellyfinClient } from '@/lib/jellyfin-client';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import type {
  JellyfinLibrariesResponse,
  JellyfinLibrarySummary,
  JellyfinLibraryMetric,
} from '@/types/jellyfin';

// Per CollectionType: which item types to count, and which one is the
// cross-library comparable "size" (leaf media file). `metrics` drive the
// human-readable breakdown; `leaf` drives the composition bar.
function typePlan(collectionType: string | undefined): {
  leaf: string | null;
  metrics: Array<{ label: string; type: string | null }>;
} {
  switch (collectionType) {
    case 'movies':
      return { leaf: 'Movie', metrics: [{ label: 'Movies', type: 'Movie' }] };
    case 'tvshows':
      return {
        leaf: 'Episode',
        metrics: [
          { label: 'Series', type: 'Series' },
          { label: 'Episodes', type: 'Episode' },
        ],
      };
    case 'music':
      return {
        leaf: 'Audio',
        metrics: [
          { label: 'Albums', type: 'MusicAlbum' },
          { label: 'Tracks', type: 'Audio' },
        ],
      };
    case 'boxsets':
      return { leaf: 'BoxSet', metrics: [{ label: 'Collections', type: 'BoxSet' }] };
    case 'homevideos':
      return { leaf: 'Video', metrics: [{ label: 'Videos', type: 'Video' }] };
    default:
      return { leaf: null, metrics: [{ label: 'Items', type: null }] };
  }
}

// Recursive TotalRecordCount for a library, optionally narrowed to one item type.
async function countItems(
  client: JellyfinClient,
  parentId: string,
  includeItemType: string | null
): Promise<number> {
  try {
    const res = await client.queryItems({
      ParentId: parentId,
      Recursive: true,
      ...(includeItemType ? { IncludeItemTypes: includeItemType } : {}),
      Limit: 0,
      EnableTotalRecordCount: true,
      EnableImages: false,
    });
    return res.TotalRecordCount ?? 0;
  } catch {
    return 0;
  }
}

async function getHandler() {
  // Gate on insights.view like the sibling insights routes; jellyfin.view is the
  // data-level gate (return empty rather than 403, matching how /library nulls
  // out services the caller can't view).
  const auth = await requireUserCapability('insights.view');
  if (!auth.ok) return auth.response;
  if (!can(auth.user, 'jellyfin.view')) {
    return NextResponse.json({ libraries: [], totalItems: 0 } satisfies JellyfinLibrariesResponse);
  }

  let client: JellyfinClient;
  try {
    client = await getJellyfinClient();
  } catch {
    // Jellyfin not configured — section simply renders empty.
    return NextResponse.json({ libraries: [], totalItems: 0 } satisfies JellyfinLibrariesResponse);
  }

  const folders = await client.getVirtualFolders().catch(() => null);
  if (!folders) {
    return NextResponse.json({ libraries: [], totalItems: 0 } satisfies JellyfinLibrariesResponse);
  }

  const libraries: JellyfinLibrarySummary[] = await Promise.all(
    folders.map(async (folder) => {
      const plan = typePlan(folder.CollectionType);

      // One count per distinct type needed (leaf may equal a metric type).
      const distinctTypes = Array.from(
        new Set<string | null>([plan.leaf, ...plan.metrics.map((m) => m.type)])
      );
      const counts = new Map<string | null, number>();
      await Promise.all(
        distinctTypes.map(async (t) => {
          counts.set(t, await countItems(client, folder.ItemId, t));
        })
      );

      const metrics: JellyfinLibraryMetric[] = plan.metrics.map((m) => ({
        label: m.label,
        value: counts.get(m.type) ?? 0,
      }));

      return {
        id: folder.ItemId,
        name: folder.Name,
        type: folder.CollectionType ?? 'mixed',
        paths: folder.Locations ?? [],
        enabled: folder.LibraryOptions?.Enabled !== false,
        itemCount: counts.get(plan.leaf) ?? 0,
        metrics,
      };
    })
  );

  libraries.sort((a, b) => b.itemCount - a.itemCount);
  const totalItems = libraries.reduce((sum, lib) => sum + lib.itemCount, 0);

  return NextResponse.json({ libraries, totalItems } satisfies JellyfinLibrariesResponse);
}

export const GET = withApiLogging(getHandler, 'api/insights/jellyfin-libraries');
