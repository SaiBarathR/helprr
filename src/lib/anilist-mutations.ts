import { gqlRequestAuthenticated } from '@/lib/anilist-auth-client';
import { MEDIA_LIST_FRAGMENT } from '@/lib/anilist-client';

export type AniListMediaListStatus =
  | 'CURRENT'
  | 'PLANNING'
  | 'COMPLETED'
  | 'DROPPED'
  | 'PAUSED'
  | 'REPEATING';

export type AniListMediaType = 'ANIME' | 'MANGA';

export interface AniListViewerStatistics {
  anime: {
    count: number;
    meanScore: number;
    minutesWatched: number;
    episodesWatched: number;
  };
  manga: {
    count: number;
    meanScore: number;
    chaptersRead: number;
    volumesRead: number;
  };
}

export interface AniListViewer {
  id: number;
  name: string;
  siteUrl: string | null;
  avatar: { large: string | null; medium: string | null } | null;
  mediaListOptions: { scoreFormat: string | null } | null;
  statistics: AniListViewerStatistics | null;
}

export interface AniListListMediaSummary {
  id: number;
  title: { romaji: string | null; english: string | null; native: string | null };
  coverImage: { extraLarge: string | null; large: string | null; medium: string | null; color: string | null } | null;
  bannerImage: string | null;
  format: string | null;
  status: string | null;
  episodes: number | null;
  chapters?: number | null;
  volumes?: number | null;
  averageScore: number | null;
  popularity: number | null;
  genres: string[] | null;
  seasonYear: number | null;
}

export interface AniListMediaListEntryBase {
  id: number;
  status: AniListMediaListStatus;
  score: number;
  progress: number;
  progressVolumes: number | null;
  repeat: number;
  notes: string | null;
  startedAt: { year: number | null; month: number | null; day: number | null } | null;
  completedAt: { year: number | null; month: number | null; day: number | null } | null;
  updatedAt: number | null;
}

export interface AniListMediaListEntry extends AniListMediaListEntryBase {
  media: AniListListMediaSummary;
}

export interface AniListMediaListGroup {
  name: string;
  status: AniListMediaListStatus | null;
  entries: AniListMediaListEntry[];
}

export interface AniListMediaListCollection {
  lists: AniListMediaListGroup[];
}

const VIEWER_QUERY = `
  query {
    Viewer {
      id
      name
      siteUrl
      avatar { large medium }
      mediaListOptions { scoreFormat }
      statistics {
        anime { count meanScore minutesWatched episodesWatched }
        manga { count meanScore chaptersRead volumesRead }
      }
    }
  }
`;

const MEDIA_LIST_COLLECTION_QUERY = `
  query ($userId: Int!, $type: MediaType!, $status: MediaListStatus) {
    MediaListCollection(userId: $userId, type: $type, status: $status) {
      lists {
        name
        status
        entries {
          id
          status
          score
          progress
          progressVolumes
          repeat
          notes
          startedAt { year month day }
          completedAt { year month day }
          updatedAt
          media {
            ${MEDIA_LIST_FRAGMENT}
            chapters
            volumes
          }
        }
      }
    }
  }
`;

const SAVE_MEDIA_LIST_ENTRY_MUTATION = `
  mutation (
    $mediaId: Int!,
    $status: MediaListStatus,
    $score: Float,
    $progress: Int,
    $progressVolumes: Int,
    $repeat: Int,
    $notes: String,
    $startedAt: FuzzyDateInput,
    $completedAt: FuzzyDateInput
  ) {
    SaveMediaListEntry(
      mediaId: $mediaId,
      status: $status,
      score: $score,
      progress: $progress,
      progressVolumes: $progressVolumes,
      repeat: $repeat,
      notes: $notes,
      startedAt: $startedAt,
      completedAt: $completedAt
    ) {
      id
      mediaId
      status
      score
      progress
      progressVolumes
      repeat
      notes
      startedAt { year month day }
      completedAt { year month day }
      updatedAt
    }
  }
`;

const DELETE_MEDIA_LIST_ENTRY_MUTATION = `
  mutation ($id: Int!) {
    DeleteMediaListEntry(id: $id) { deleted }
  }
`;

const MEDIA_LIST_ENTRY_QUERY = `
  query ($userId: Int!, $mediaId: Int!) {
    MediaList(userId: $userId, mediaId: $mediaId) {
      id
      status
      score
      progress
      progressVolumes
      repeat
      notes
      startedAt { year month day }
      completedAt { year month day }
      updatedAt
    }
  }
`;

export interface SaveMediaListEntryInput {
  mediaId: number;
  status?: AniListMediaListStatus;
  score?: number;
  progress?: number;
  progressVolumes?: number;
  repeat?: number;
  notes?: string;
  startedAt?: { year?: number; month?: number; day?: number };
  completedAt?: { year?: number; month?: number; day?: number };
}

export async function fetchViewer(): Promise<AniListViewer> {
  const data = await gqlRequestAuthenticated<{ Viewer: AniListViewer }>(VIEWER_QUERY);
  return data.Viewer;
}

export async function fetchMediaListCollection(params: {
  userId: number;
  type: AniListMediaType;
  status?: AniListMediaListStatus;
}): Promise<AniListMediaListCollection> {
  const data = await gqlRequestAuthenticated<{ MediaListCollection: AniListMediaListCollection | null }>(
    MEDIA_LIST_COLLECTION_QUERY,
    {
      userId: params.userId,
      type: params.type,
      ...(params.status ? { status: params.status } : {}),
    }
  );
  return data.MediaListCollection ?? { lists: [] };
}

export async function saveMediaListEntry(input: SaveMediaListEntryInput): Promise<AniListMediaListEntryBase & { mediaId: number }> {
  const data = await gqlRequestAuthenticated<{ SaveMediaListEntry: AniListMediaListEntryBase & { mediaId: number } }>(
    SAVE_MEDIA_LIST_ENTRY_MUTATION,
    input as unknown as Record<string, unknown>
  );
  return data.SaveMediaListEntry;
}

export async function deleteMediaListEntry(id: number): Promise<{ deleted: boolean }> {
  const data = await gqlRequestAuthenticated<{ DeleteMediaListEntry: { deleted: boolean } }>(
    DELETE_MEDIA_LIST_ENTRY_MUTATION,
    { id }
  );
  return data.DeleteMediaListEntry;
}

export async function fetchUserMediaListEntry(params: {
  userId: number;
  mediaId: number;
}): Promise<AniListMediaListEntryBase | null> {
  try {
    const data = await gqlRequestAuthenticated<{
      MediaList: AniListMediaListEntryBase | null;
    }>(MEDIA_LIST_ENTRY_QUERY, params);
    return data.MediaList ?? null;
  } catch (error) {
    // AniList returns a top-level error when no entry exists
    if (error instanceof Error && /not found|MediaList not found/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}
