import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import type { JellyfinItem } from '@/types/jellyfin';

type ResolveType = 'movie' | 'series' | 'episode';

interface ResolveMatch {
  itemId: string;
  itemType: string;
  seriesId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  confidence: number;
  reason: string;
  name: string;
  productionYear?: number;
}

interface ScoredCandidate {
  item: JellyfinItem;
  score: number;
  reason: string;
}

function normalize(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getProviderId(item: JellyfinItem, provider: string): string | undefined {
  const entries = Object.entries(item.ProviderIds || {});
  const matched = entries.find(([key]) => key.toLowerCase() === provider.toLowerCase());
  return matched?.[1];
}

function scoreMovieOrSeriesCandidate(
  item: JellyfinItem,
  options: {
    tmdbId?: string;
    tvdbId?: string;
    imdbId?: string;
    title?: string;
    year?: number;
  },
): ScoredCandidate {
  let score = 0;
  const reasons: string[] = [];

  if (options.tmdbId && getProviderId(item, 'Tmdb') === options.tmdbId) {
    score += 100;
    reasons.push('TMDB match');
  }
  if (options.tvdbId && getProviderId(item, 'Tvdb') === options.tvdbId) {
    score += 100;
    reasons.push('TVDB match');
  }
  if (options.imdbId && getProviderId(item, 'Imdb') === options.imdbId) {
    score += 95;
    reasons.push('IMDb match');
  }

  const expectedTitle = normalize(options.title);
  const actualTitle = normalize(item.Name);
  if (expectedTitle && actualTitle) {
    if (expectedTitle === actualTitle) {
      score += 35;
      reasons.push('exact title match');
    } else if (actualTitle.includes(expectedTitle) || expectedTitle.includes(actualTitle)) {
      score += 20;
      reasons.push('partial title match');
    }
  }

  if (options.year && item.ProductionYear === options.year) {
    score += 15;
    reasons.push('year match');
  }

  return {
    item,
    score,
    reason: reasons.join(', ') || 'fallback match',
  };
}

function pickBestCandidate(candidates: ScoredCandidate[]): ScoredCandidate | null {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  return sorted[0];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = (searchParams.get('type') || '').toLowerCase() as ResolveType;

    const itemId = searchParams.get('itemId') || undefined;
    if (itemId) {
      const client = await getJellyfinClient();
      const item = await client.getItem(itemId);
      const match: ResolveMatch = {
        itemId: item.Id,
        itemType: item.Type,
        seriesId: item.SeriesId,
        seasonNumber: item.ParentIndexNumber,
        episodeNumber: item.IndexNumber,
        confidence: 100,
        reason: 'Direct itemId provided',
        name: item.Name,
        productionYear: item.ProductionYear,
      };
      return NextResponse.json({ match, item });
    }

    if (!type || !['movie', 'series', 'episode'].includes(type)) {
      return NextResponse.json(
        { error: 'type must be one of movie, series, or episode' },
        { status: 400 },
      );
    }

    const tmdbId = searchParams.get('tmdbId') || undefined;
    const tvdbId = searchParams.get('tvdbId') || undefined;
    const imdbId = searchParams.get('imdbId') || undefined;
    const title = searchParams.get('title') || searchParams.get('seriesTitle') || undefined;
    const year = searchParams.get('year') ? parseInt(searchParams.get('year')!, 10) : undefined;
    const seasonNumber = searchParams.get('seasonNumber')
      ? parseInt(searchParams.get('seasonNumber')!, 10)
      : undefined;
    const episodeNumber = searchParams.get('episodeNumber')
      ? parseInt(searchParams.get('episodeNumber')!, 10)
      : undefined;
    const episodeTitle = searchParams.get('episodeTitle') || undefined;

    const client = await getJellyfinClient();

    if (type === 'movie') {
      const response = await client.getGlobalItems({
        Recursive: true,
        IncludeItemTypes: 'Movie',
        Fields: 'ProviderIds,ProductionYear',
        SearchTerm: title,
        Limit: title ? 250 : 1000,
        SortBy: 'SortName',
        SortOrder: 'Ascending',
      });

      const scored = response.Items.map((item) =>
        scoreMovieOrSeriesCandidate(item, { tmdbId, imdbId, title, year }),
      );
      const best = pickBestCandidate(scored);

      if (!best || best.score < 20) {
        return NextResponse.json({ match: null, error: 'No movie match found in Jellyfin' }, { status: 404 });
      }

      const match: ResolveMatch = {
        itemId: best.item.Id,
        itemType: best.item.Type,
        confidence: best.score,
        reason: best.reason,
        name: best.item.Name,
        productionYear: best.item.ProductionYear,
      };

      return NextResponse.json({ match, item: best.item });
    }

    if (type === 'series') {
      const response = await client.getGlobalItems({
        Recursive: true,
        IncludeItemTypes: 'Series',
        Fields: 'ProviderIds,ProductionYear',
        SearchTerm: title,
        Limit: title ? 250 : 1000,
        SortBy: 'SortName',
        SortOrder: 'Ascending',
      });

      const scored = response.Items.map((item) =>
        scoreMovieOrSeriesCandidate(item, { tvdbId, imdbId, title, year }),
      );
      const best = pickBestCandidate(scored);

      if (!best || best.score < 20) {
        return NextResponse.json({ match: null, error: 'No series match found in Jellyfin' }, { status: 404 });
      }

      const match: ResolveMatch = {
        itemId: best.item.Id,
        itemType: best.item.Type,
        confidence: best.score,
        reason: best.reason,
        name: best.item.Name,
        productionYear: best.item.ProductionYear,
      };

      return NextResponse.json({ match, item: best.item });
    }

    if (seasonNumber == null || episodeNumber == null) {
      return NextResponse.json(
        { error: 'seasonNumber and episodeNumber are required for episode resolve' },
        { status: 400 },
      );
    }

    const seriesCandidates = await client.getGlobalItems({
      Recursive: true,
      IncludeItemTypes: 'Series',
      Fields: 'ProviderIds,ProductionYear',
      SearchTerm: title,
      Limit: title ? 250 : 1000,
      SortBy: 'SortName',
      SortOrder: 'Ascending',
    });

    const scoredSeries = seriesCandidates.Items.map((item) =>
      scoreMovieOrSeriesCandidate(item, { tvdbId, imdbId, title, year }),
    );
    const bestSeries = pickBestCandidate(scoredSeries);

    if (!bestSeries || bestSeries.score < 20) {
      return NextResponse.json({ match: null, error: 'No series match found for episode resolve' }, { status: 404 });
    }

    const episodes = await client.getGlobalItems({
      ParentId: bestSeries.item.Id,
      Recursive: true,
      IncludeItemTypes: 'Episode',
      Fields: 'ParentIndexNumber,IndexNumber',
      Limit: 5000,
      SortBy: 'ParentIndexNumber,IndexNumber',
      SortOrder: 'Ascending',
    });

    let matchedEpisode = episodes.Items.find(
      (item) => item.ParentIndexNumber === seasonNumber && item.IndexNumber === episodeNumber,
    );

    if (!matchedEpisode && episodeTitle) {
      const normalizedEpisodeTitle = normalize(episodeTitle);
      matchedEpisode = episodes.Items.find(
        (item) =>
          item.ParentIndexNumber === seasonNumber && normalize(item.Name) === normalizedEpisodeTitle,
      );
    }

    if (!matchedEpisode) {
      return NextResponse.json(
        {
          match: null,
          error: `No episode match found for S${seasonNumber}E${episodeNumber}`,
        },
        { status: 404 },
      );
    }

    const match: ResolveMatch = {
      itemId: matchedEpisode.Id,
      itemType: matchedEpisode.Type,
      seriesId: bestSeries.item.Id,
      seasonNumber: matchedEpisode.ParentIndexNumber,
      episodeNumber: matchedEpisode.IndexNumber,
      confidence: Math.max(60, bestSeries.score),
      reason: `Series: ${bestSeries.reason}; episode number match`,
      name: matchedEpisode.Name,
      productionYear: matchedEpisode.ProductionYear,
    };

    return NextResponse.json({ match, item: matchedEpisode, series: bestSeries.item });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve Jellyfin item';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
