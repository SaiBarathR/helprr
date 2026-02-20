import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';

function episodeSortValue(season: number | undefined, episode: number | undefined): number {
  if (season == null || episode == null) return -1;
  return season * 10000 + episode;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get('itemId');

    if (!itemId) {
      return NextResponse.json({ error: 'itemId is required' }, { status: 400 });
    }

    const client = await getJellyfinClient();
    const item = await client.getItem(itemId);

    if (item.Type !== 'Episode' || !item.SeriesId) {
      return NextResponse.json({ item: null });
    }

    const currentOrder = episodeSortValue(item.ParentIndexNumber, item.IndexNumber);
    if (currentOrder < 0) {
      return NextResponse.json({ item: null });
    }

    const response = await client.getGlobalItems({
      ParentId: item.SeriesId,
      Recursive: true,
      IncludeItemTypes: 'Episode',
      Fields: 'ParentIndexNumber,IndexNumber,UserData,SeriesName,ImageTags',
      Limit: 5000,
      SortBy: 'ParentIndexNumber,IndexNumber',
      SortOrder: 'Ascending',
    });

    const episodes = response.Items
      .filter((episode) => episode.Type === 'Episode')
      .sort((a, b) => {
        const orderA = episodeSortValue(a.ParentIndexNumber, a.IndexNumber);
        const orderB = episodeSortValue(b.ParentIndexNumber, b.IndexNumber);
        return orderA - orderB;
      });

    const nextEpisode = episodes.find((episode) => {
      const order = episodeSortValue(episode.ParentIndexNumber, episode.IndexNumber);
      return order > currentOrder;
    });

    return NextResponse.json({ item: nextEpisode || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve next episode';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
