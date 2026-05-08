import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  AniListReauthRequiredError,
  loadAniListConnection,
} from '@/lib/anilist-oauth';
import { fetchViewer } from '@/lib/anilist-mutations';

interface ViewerResponse {
  configured: boolean;
  connected: boolean | null;
  requiresReauth: boolean;
  transientError?: boolean;
  user?: {
    id: number;
    name: string;
    avatar: string | null;
    siteUrl: string | null;
    scoreFormat: string | null;
    statistics?: {
      anime: { count: number; meanScore: number; minutesWatched: number; episodesWatched: number };
      manga: { count: number; meanScore: number; chaptersRead: number; volumesRead: number };
    };
  };
}

export async function GET(): Promise<NextResponse<ViewerResponse>> {
  const authError = await requireAuth();
  if (authError) return authError as unknown as NextResponse<ViewerResponse>;

  const conn = await loadAniListConnection();
  if (!conn) {
    return NextResponse.json({ configured: false, connected: false, requiresReauth: false });
  }

  if (!conn.accessToken) {
    return NextResponse.json({
      configured: true,
      connected: false,
      requiresReauth: true,
      ...(conn.username
        ? {
            user: {
              id: conn.anilistUserId ?? 0,
              name: conn.username,
              avatar: conn.avatar,
              siteUrl: conn.siteUrl,
              scoreFormat: conn.scoreFormat,
            },
          }
        : {}),
    });
  }

  try {
    const viewer = await fetchViewer();
    return NextResponse.json({
      configured: true,
      connected: true,
      requiresReauth: false,
      user: {
        id: viewer.id,
        name: viewer.name,
        avatar: viewer.avatar?.large ?? viewer.avatar?.medium ?? null,
        siteUrl: viewer.siteUrl,
        scoreFormat: viewer.mediaListOptions?.scoreFormat ?? null,
        ...(viewer.statistics ? { statistics: viewer.statistics } : {}),
      },
    });
  } catch (error) {
    if (error instanceof AniListReauthRequiredError) {
      return NextResponse.json({ configured: true, connected: false, requiresReauth: true });
    }
    console.error('AniList viewer fetch failed', error);
    return NextResponse.json(
      { configured: true, connected: null, requiresReauth: false, transientError: true },
      { status: 503 }
    );
  }
}
