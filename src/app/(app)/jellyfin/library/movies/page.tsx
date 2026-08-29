'use client';

import { CollectionHub } from '@/components/jellyfin-streaming/cinematic/collection-hub';

export default function WatchMoviesPage() {
  return <CollectionHub title="Movies" collectionType="movies" includeItemTypes="Movie" />;
}
