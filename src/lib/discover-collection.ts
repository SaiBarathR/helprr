import { getTMDBClient, loadTaggedLibrary } from '@/lib/service-helpers';
import { normalizeTmdbItem, annotateDiscoverItems, tmdbImageUrl } from '@/lib/discover';
import type { DiscoverCollectionDetail, DiscoverItem } from '@/types';

/**
 * Load a TMDB collection with its parts annotated against the current library.
 * Server-only; callers do their own authorization first. The collection page
 * calls this directly rather than fetching its own API over HTTP, so no
 * request-derived host or forwarded cookie is ever involved.
 */
export async function getDiscoverCollectionDetail(id: number): Promise<DiscoverCollectionDetail> {
  const tmdb = await getTMDBClient();

  const [collection, { movies, series }] = await Promise.all([
    tmdb.collectionDetails(id),
    loadTaggedLibrary(),
  ]);

  const parts: DiscoverItem[] = (collection.parts || [])
    .sort((a, b) => {
      const dateA = a.release_date || '';
      const dateB = b.release_date || '';
      return dateA.localeCompare(dateB);
    })
    .map((item) => normalizeTmdbItem(item, 'movie'))
    .filter((item): item is DiscoverItem => item !== null);

  return {
    id: collection.id,
    name: collection.name,
    overview: collection.overview || '',
    posterPath: tmdbImageUrl(collection.poster_path),
    backdropPath: tmdbImageUrl(collection.backdrop_path, 'w1280'),
    parts: annotateDiscoverItems(parts, movies, series),
  };
}
