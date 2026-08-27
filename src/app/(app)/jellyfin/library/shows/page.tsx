'use client';

import { CollectionHub } from '@/components/jellyfin-streaming/cinematic/collection-hub';

export default function WatchShowsPage() {
  return <CollectionHub title="TV Shows" collectionType="tvshows" includeItemTypes="Series" />;
}
