import { NextRequest, NextResponse } from 'next/server';
import { getTMDBClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { TmdbRateLimitError } from '@/lib/tmdb-client';
import { tmdbImageUrl } from '@/lib/discover';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const id = Number(new URL(request.url).searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid person id' }, { status: 400 });
    }

    const tmdb = await getTMDBClient();
    const [person, externalIds, credits] = await Promise.all([
      tmdb.personDetails(id),
      tmdb.personExternalIds(id),
      tmdb.personCombinedCredits(id),
    ]);

    // Dedupe and sort credits by popularity
    const seenCast = new Set<string>();
    const castCredits = credits.cast
      .filter((c) => {
        const key = `${c.media_type}-${c.id}`;
        if (seenCast.has(key)) return false;
        seenCast.add(key);
        return true;
      })
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

    const seenCrew = new Set<string>();
    const crewCredits = credits.crew
      .filter((c) => {
        const key = `${c.media_type}-${c.id}-${c.job}`;
        if (seenCrew.has(key)) return false;
        seenCrew.add(key);
        return true;
      })
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

    const mapCredit = (c: (typeof credits.cast)[0]) => ({
      id: c.id,
      mediaType: c.media_type,
      title: c.title || c.name || '',
      posterPath: tmdbImageUrl(c.poster_path, 'w300'),
      releaseDate: c.release_date || c.first_air_date || null,
      year: (() => {
        const d = c.release_date || c.first_air_date;
        if (!d) return null;
        const n = Number(d.slice(0, 4));
        return Number.isFinite(n) ? n : null;
      })(),
      rating: c.vote_average ?? 0,
      voteCount: c.vote_count ?? 0,
      popularity: c.popularity ?? 0,
      character: c.character || null,
      department: c.department || null,
      job: c.job || null,
      episodeCount: c.episode_count || null,
    });

    return NextResponse.json({
      id: person.id,
      name: person.name,
      biography: person.biography || '',
      birthday: person.birthday,
      deathday: person.deathday,
      placeOfBirth: person.place_of_birth,
      profilePath: tmdbImageUrl(person.profile_path, 'w500'),
      knownForDepartment: person.known_for_department,
      alsoKnownAs: person.also_known_as || [],
      homepage: person.homepage,
      popularity: person.popularity,
      gender: person.gender,
      externalIds: {
        imdbId: externalIds.imdb_id || null,
        facebookId: externalIds.facebook_id || null,
        instagramId: externalIds.instagram_id || null,
        twitterId: externalIds.twitter_id || null,
        tiktokId: externalIds.tiktok_id || null,
        youtubeId: externalIds.youtube_id || null,
      },
      castCredits: castCredits.map(mapCredit),
      crewCredits: crewCredits.map(mapCredit),
    });
  } catch (error) {
    if (error instanceof TmdbRateLimitError) {
      return NextResponse.json(
        {
          error: 'TMDB rate limit reached',
          code: 'TMDB_RATE_LIMIT',
          retryAfterSeconds: error.retryAfterSeconds,
          retryAt: error.retryAt,
        },
        { status: 429 }
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to load person';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
