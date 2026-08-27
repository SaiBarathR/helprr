import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import type { CatalogItemDetailResponse } from '@/types/jellyfin-streaming';

const ITEM_ID_RE = /^[a-f0-9-]+$/i;

async function getHandler(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  const { itemId } = await context.params;
  if (!ITEM_ID_RE.test(itemId)) {
    return NextResponse.json({ error: 'Invalid itemId' }, { status: 400 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const expand = new Set((searchParams.get('expand') ?? '').split(',').map((part) => part.trim()).filter(Boolean));
    const client = await getJellyfinClientForUser(auth.user);
    const item = await client.getItem(itemId);

    const payload: CatalogItemDetailResponse = { linked: true, item };

    const jobs: Array<Promise<void>> = [];
    if (item.Type === 'Series' || item.Type === 'Season' || item.Type === 'Episode') {
      // Season and episode pages need the sibling seasons to offer a picker.
      const seriesId = item.Type === 'Series' ? itemId : (item.SeriesId || item.ParentId || itemId);
      jobs.push(client.getSeasons(seriesId).then((data) => { payload.seasons = data.Items ?? []; }).catch(() => {
        payload.seasons = [];
      }));
    }
    if (expand.has('episodes') && (item.Type === 'Season' || item.Type === 'Series' || item.Type === 'Episode')) {
      // A season lists only its own episodes; an episode lists its season's, so
      // the page can offer "More from Season N".
      const seriesId = item.Type === 'Series' ? itemId : (item.SeriesId || item.ParentId || itemId);
      const seasonId = item.Type === 'Season' ? itemId : item.Type === 'Episode' ? item.SeasonId : undefined;
      jobs.push(client.getSeriesEpisodes(seriesId, seasonId).then((data) => {
        payload.episodes = data.Items ?? [];
      }).catch(() => {
        payload.episodes = [];
      }));
    }
    if (item.Type === 'Movie' || item.Type === 'Series') {
      jobs.push(client.getSimilarItems(itemId).then((data) => { payload.similar = data.Items ?? []; }).catch(() => {
        payload.similar = [];
      }));
      jobs.push(client.getSpecialFeatures(itemId).then((items) => { payload.specialFeatures = items ?? []; }).catch(() => {
        payload.specialFeatures = [];
      }));
      jobs.push(client.getLocalTrailers(itemId).then((items) => { payload.localTrailers = items ?? []; }).catch(() => {
        payload.localTrailers = [];
      }));
    }
    if (expand.has('instantMix') || item.MediaType === 'Audio' || item.Type === 'MusicAlbum' || item.Type === 'MusicArtist') {
      jobs.push(client.getInstantMix(itemId).then((data) => { payload.instantMix = data.Items ?? []; }).catch(() => {
        payload.instantMix = [];
      }));
    }
    if (expand.has('segments') || item.MediaType === 'Video') {
      jobs.push(client.getMediaSegments(itemId).then((data) => { payload.segments = data.Items ?? []; }).catch(() => {
        payload.segments = [];
      }));
    }
    if (expand.has('theme')) {
      jobs.push(client.getThemeMedia(itemId).then((data) => {
        payload.themeMedia = {
          themeSongs: data.ThemeSongsResult?.Items ?? [],
          themeVideos: data.ThemeVideosResult?.Items ?? [],
          soundtrackSongs: data.SoundtrackSongsResult?.Items ?? [],
        };
      }).catch(() => {
        payload.themeMedia = { themeSongs: [], themeVideos: [], soundtrackSongs: [] };
      }));
    }
    if (item.Type === 'BoxSet' || item.Type === 'Playlist' || item.Type === 'Folder' || item.Type === 'MusicAlbum') {
      jobs.push(client.getCatalogItems({
        ParentId: itemId,
        Limit: 200,
        Recursive: item.Type === 'Playlist' || item.Type === 'MusicAlbum',
        SortBy: item.Type === 'MusicAlbum' ? 'IndexNumber' : 'SortName',
      }).then((data) => { payload.children = data.Items ?? []; }).catch(() => {
        payload.children = [];
      }));
    }
    if (item.Type === 'Person') {
      jobs.push(client.getCatalogItems({
        PersonIds: itemId,
        Recursive: true,
        Limit: 80,
        IncludeItemTypes: 'Movie,Series,Episode',
        SortBy: 'PremiereDate',
        SortOrder: 'Descending',
      }).then((data) => { payload.filmography = data.Items ?? []; }).catch(() => {
        payload.filmography = [];
      }));
    }

    await Promise.all(jobs);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({ linked: false, item: null } satisfies CatalogItemDetailResponse);
    }
    return upstreamErrorResponse(error, 'Failed to load Jellyfin item');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/catalog/items/[itemId]');
