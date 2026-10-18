import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { isItemKey } from '@/lib/recommendations/item-keys';
import { isValidGenreList } from '@/lib/recommendations/events';
import { getRating, isRating, setRating } from '@/lib/recommendations/ratings';

// The signed-in user's own rating of one title; no user id is ever accepted.

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('recommendations.view');
  if (!auth.ok) return auth.response;
  const itemKey = new URL(request.url).searchParams.get('itemKey') ?? '';
  if (!isItemKey(itemKey)) return NextResponse.json({ error: 'Invalid itemKey' }, { status: 400 });
  return NextResponse.json({ rating: await getRating(auth.user.id, itemKey) });
}

async function putHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('recommendations.view');
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { itemKey, rating, genres } = body ?? {};
  if (typeof itemKey !== 'string' || !isItemKey(itemKey)) {
    return NextResponse.json({ error: 'Invalid itemKey' }, { status: 400 });
  }
  if (rating !== null && !isRating(rating)) {
    return NextResponse.json({ error: 'rating must be down, up, love or null' }, { status: 400 });
  }
  if (genres !== undefined && !isValidGenreList(genres)) {
    return NextResponse.json({ error: 'Invalid genres' }, { status: 400 });
  }
  await setRating(auth.user.id, itemKey, rating, genres);
  return NextResponse.json({ rating });
}

export const GET = withApiLogging(getHandler, 'api/recommendations/rating');
export const PUT = withApiLogging(putHandler, 'api/recommendations/rating');
