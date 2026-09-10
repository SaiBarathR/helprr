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
    const legacy = !searchParams.has('expand');
    const wants = (name: string) => legacy || expand.has(name);
    const client = (await getJellyfinClientForUser(auth.user)).withReadSignal(request.signal);
    const item = await client.getItem(itemId);

    const payload: CatalogItemDetailResponse = { linked: true, item };

    const jobs: Array<Promise<void>> = [];
    if (wants('seasons') && (item.Type === 'Series' || item.Type === 'Season' || item.Type === 'Episode')) {
      // Season and episode pages need the sibling seasons to offer a picker.
      const seriesId = item.Type === 'Series' ? itemId : (item.SeriesId || item.ParentId || itemId);
      jobs.push(client.getSeasons(seriesId).then((data) => { payload.seasons = data.Items ?? []; }).catch(() => {
        (payload.failedExpansions ??= []).push('seasons');
        payload.seasons = [];
      }));
    }
    if (expand.has('episodes') && (item.Type === 'Season' || item.Type === 'Series' || item.Type === 'Episode')) {
      // A season lists only its own episodes; an episode lists its season's, so
      // the page can offer "More from Season N".
      const seriesId = item.Type === 'Series' ? itemId : (item.SeriesId || item.ParentId || itemId);
      const seasonId = item.Type === 'Season' ? itemId : item.Type === 'Episode' ? item.SeasonId : undefined;
      const page = searchParams.has('episodeLimit') ? {
        startIndex: Math.max(0, Number.parseInt(searchParams.get('episodeStart') ?? '0', 10) || 0),
        limit: Math.min(100, Math.max(1, Number.parseInt(searchParams.get('episodeLimit') ?? '50', 10) || 50)),
      } : undefined;
      jobs.push(client.getSeriesEpisodes(seriesId, seasonId, page).then((data) => {
        if (page) { payload.episodesTotal = data.TotalRecordCount ?? data.Items?.length ?? 0; payload.episodesStart = page.startIndex; }
        payload.episodes = data.Items ?? [];
      }).catch(() => {
        (payload.failedExpansions ??= []).push('episodes');
        payload.episodes = [];
      }));
    }
    if (item.Type === 'Movie' || item.Type === 'Series') {
      if (wants('similar')) jobs.push(client.getSimilarItems(itemId).then((data) => { payload.similar = data.Items ?? []; }).catch(() => {
        (payload.failedExpansions ??= []).push('similar');
        payload.similar = [];
      }));
      if (wants('specials')) jobs.push(client.getSpecialFeatures(itemId).then((items) => { payload.specialFeatures = items ?? []; }).catch(() => {
        (payload.failedExpansions ??= []).push('specialFeatures');
        payload.specialFeatures = [];
      }));
      if (wants('trailers')) jobs.push(client.getLocalTrailers(itemId).then((items) => { payload.localTrailers = items ?? []; }).catch(() => {
        (payload.failedExpansions ??= []).push('localTrailers');
        payload.localTrailers = [];
      }));
    }
    if (wants('instantMix') && (item.MediaType === 'Audio' || item.Type === 'MusicAlbum' || item.Type === 'MusicArtist')) {
      jobs.push(client.getInstantMix(itemId).then((data) => { payload.instantMix = data.Items ?? []; }).catch(() => {
        (payload.failedExpansions ??= []).push('instantMix');
        payload.instantMix = [];
      }));
    }
    if (wants('segments')) {
      jobs.push(client.getMediaSegments(itemId).then((data) => { payload.segments = data.Items ?? []; }).catch(() => {
        (payload.failedExpansions ??= []).push('segments');
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
    if (wants('children') && (item.Type === 'BoxSet' || item.Type === 'Playlist' || item.Type === 'Folder' || item.Type === 'MusicAlbum')) {
      jobs.push(client.getCatalogItems({
        ParentId: itemId,
        Limit: 200,
        Recursive: item.Type === 'Playlist' || item.Type === 'MusicAlbum',
        SortBy: item.Type === 'MusicAlbum' ? 'IndexNumber' : 'SortName',
      }).then((data) => { payload.children = data.Items ?? []; }).catch(() => {
        (payload.failedExpansions ??= []).push('children');
        payload.children = [];
      }));
    }
    if (wants('filmography') && item.Type === 'Person') {
      jobs.push(client.getCatalogItems({
        PersonIds: itemId,
        Recursive: true,
        Limit: 80,
        IncludeItemTypes: 'Movie,Series,Episode',
        SortBy: 'PremiereDate',
        SortOrder: 'Descending',
      }).then((data) => { payload.filmography = data.Items ?? []; }).catch(() => {
        (payload.failedExpansions ??= []).push('filmography');
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
