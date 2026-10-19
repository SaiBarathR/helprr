'use client';

import type { ReactNode } from 'react';
import { FadeInImage } from '@/components/media/fade-in-image';
import Link from '@/components/ui/app-link';
import { Badge } from '@/components/ui/badge';
import { AnimeCharacterRail } from '@/components/anime/anime-character-rail';
import { AnimeRelationsSection } from '@/components/anime/anime-relations-section';
import { AnimeMediaRail } from '@/components/anime/anime-media-rail';
import { DiscoverInfoRows } from '@/components/discover/discover-info-rows';
import { ExternalLink, Loader2, Trophy, TrendingUp } from 'lucide-react';
import type { AniListDetailResponse } from '@/types/anilist';
import { sanitizeHtml } from '@/lib/sanitize-html';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { formatAniListRankingLabel, formatFuzzyDate } from '@/lib/anilist-helpers';
import { formatRegionCode } from '@/lib/media-locale';
import { STATUS_COLORS, STATUS_LABELS } from './format';
import { animeStartDateOf } from './series-info';

/**
 * A mapped anime's AniList sections, below the facts: synopsis, AniList's
 * information, alternative titles, genres and tags, characters, staff,
 * rankings, distributions, relations, recommendations and external links.
 */
export function SeriesAnimeSections({
  animeDetail,
  overviewExpanded,
  onToggleOverview,
  jellyfinLink,
}: {
  animeDetail: AniListDetailResponse;
  overviewExpanded: boolean;
  onToggleOverview: () => void;
  /** "Open in Jellyfin" when Jellyfin is set up and the series has an id it can look up. */
  jellyfinLink: { loading: boolean; onOpen: () => void } | null;
}) {
  const animeDescription = animeDetail?.description ? sanitizeHtml(animeDetail.description) : '';
  const animeInfoRows: Array<{ label: string; value: string; valueNode?: ReactNode }> = [];
  if (animeDetail?.format) animeInfoRows.push({ label: 'Format', value: animeDetail.format.replace(/_/g, ' ') });
  const animeOriginCountry = formatRegionCode(animeDetail?.countryOfOrigin);
  if (animeOriginCountry) animeInfoRows.push({ label: 'Country of Origin', value: animeOriginCountry });
  if (animeDetail?.episodes != null) animeInfoRows.push({ label: 'Episodes', value: String(animeDetail.episodes) });
  if (animeDetail?.duration != null) animeInfoRows.push({ label: 'Episode Duration', value: `${animeDetail.duration} mins` });
  if (animeDetail?.status) animeInfoRows.push({ label: 'Status', value: animeDetail.status.charAt(0) + animeDetail.status.slice(1).toLowerCase().replace(/_/g, ' ') });
  const animeStartDate = animeStartDateOf(animeDetail);
  if (animeStartDate) animeInfoRows.push({ label: 'Start Date', value: animeStartDate });
  const animeEndDate = formatFuzzyDate(animeDetail?.endDate ?? null);
  if (animeEndDate) animeInfoRows.push({ label: 'End Date', value: animeEndDate });
  if (animeDetail?.season && animeDetail.seasonYear) {
    animeInfoRows.push({ label: 'Season', value: `${animeDetail.season.charAt(0)}${animeDetail.season.slice(1).toLowerCase()} ${animeDetail.seasonYear}` });
  }
  if (animeDetail?.averageScore != null) animeInfoRows.push({ label: 'Average Score', value: `${animeDetail.averageScore}%` });
  if (animeDetail?.meanScore != null) animeInfoRows.push({ label: 'Mean Score', value: `${animeDetail.meanScore}%` });
  if (animeDetail?.popularity != null) animeInfoRows.push({ label: 'Popularity', value: animeDetail.popularity.toLocaleString() });
  if (animeDetail?.favourites != null) animeInfoRows.push({ label: 'Favorites', value: animeDetail.favourites.toLocaleString() });
  const mainStudios = animeDetail?.studios.filter((studio) => studio.isMain) ?? [];
  if (mainStudios.length > 0) {
    animeInfoRows.push({
      label: 'Studios',
      value: mainStudios.map((studio) => studio.name).join(', '),
      valueNode: (
        <span>
          {mainStudios.map((studio, index) => (
            <span key={studio.id}>
              {index > 0 && ', '}
              <Link href={`/anime/studio/${studio.id}`} className="text-primary hover:underline">{studio.name}</Link>
            </span>
          ))}
        </span>
      ),
    });
  }
  const producers = animeDetail?.studios.filter((studio) => !studio.isMain) ?? [];
  if (producers.length > 0) {
    animeInfoRows.push({
      label: 'Producers',
      value: producers.map((studio) => studio.name).join(', '),
      valueNode: (
        <span>
          {producers.map((studio, index) => (
            <span key={studio.id}>
              {index > 0 && ', '}
              <Link href={`/anime/studio/${studio.id}`} className="text-primary hover:underline">{studio.name}</Link>
            </span>
          ))}
        </span>
      ),
    });
  }
  if (animeDetail?.source) {
    animeInfoRows.push({
      label: 'Source',
      value: animeDetail.source.replace(/_/g, ' ').split(' ').map((word) => word.charAt(0) + word.slice(1).toLowerCase()).join(' '),
    });
  }
  if (animeDetail?.hashtag) animeInfoRows.push({ label: 'Hashtag', value: animeDetail.hashtag });
  const animeAltTitles: { label: string; value: string }[] = [];
  if (animeDetail?.titleRomaji) animeAltTitles.push({ label: 'Romaji', value: animeDetail.titleRomaji });
  const animeEnglishTitle = animeDetail && animeDetail.title !== animeDetail.titleRomaji ? animeDetail.title : null;
  if (animeEnglishTitle && animeEnglishTitle !== animeDetail?.titleNative) {
    animeAltTitles.push({ label: 'English', value: animeEnglishTitle });
  }
  if (animeDetail?.titleNative) animeAltTitles.push({ label: 'Native', value: animeDetail.titleNative });
  if (animeDetail?.synonyms?.length) animeAltTitles.push({ label: 'Synonyms', value: animeDetail.synonyms.join(', ') });
  const animeTags = animeDetail?.tags.filter((tag) => !tag.isSpoiler) ?? [];
  const animeScoreDistribution = animeDetail?.scoreDistribution ?? [];
  const maxScoreAmount = animeScoreDistribution.length > 0
    ? Math.max(...animeScoreDistribution.map((entry) => entry.amount))
    : 0;
  const animeStatusDistribution = animeDetail?.statusDistribution ?? [];
  const totalStatusUsers = animeStatusDistribution.reduce((sum, entry) => sum + entry.amount, 0);
  const animeLinks: Array<{ label: string; url: string }> = animeDetail ? [
    { label: 'AniList', url: `https://anilist.co/anime/${animeDetail.id}` },
    ...(animeDetail.malId ? [{ label: 'MyAnimeList', url: `https://myanimelist.net/anime/${animeDetail.malId}` }] : []),
  ] : [];

  return (
    <div className="space-y-5 mt-2">
      {animeDescription && (
        <div>
          <h2 className="text-base font-semibold mb-1">Synopsis</h2>
          <div
            className={`text-sm text-muted-foreground leading-relaxed [&_i]:italic [&_br]:mb-2 ${overviewExpanded ? '' : 'line-clamp-5'}`}
            dangerouslySetInnerHTML={{ __html: animeDescription }}
          />
          {animeDescription.length > 200 && (
            <button
              onClick={onToggleOverview}
              className="text-xs text-primary mt-1 font-medium"
            >
              {overviewExpanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>
      )}

      <div>
        <DiscoverInfoRows title="AniList Information" rows={animeInfoRows} />
      </div>

      {animeAltTitles.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-2">Alternative Titles</h2>
          <div className="detail-info-rows">
            {animeAltTitles.map((title) => (
              <div
                key={title.label}
                className="flex justify-between items-start py-2.5 border-b border-border/40 last:border-b-0"
              >
                <span className="text-sm text-muted-foreground shrink-0">{title.label}</span>
                <span className="text-sm text-right ml-4">{title.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(animeDetail?.genres.length || animeTags.length > 0) && (
        <div>
          <h2 className="text-base font-semibold mb-2">Genres & Tags</h2>
          <div className="flex flex-wrap gap-1.5">
            {(animeDetail?.genres ?? []).map((genre) => (
              <Badge key={genre} variant="secondary" className="text-xs">
                {genre}
              </Badge>
            ))}
            {animeTags.slice(0, 15).map((tag) => (
              <Badge key={tag.name} variant="outline" className="text-xs">
                {tag.name}
                <span className="ml-1 text-muted-foreground">{tag.rank}%</span>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {animeDetail && <div><AnimeCharacterRail characters={animeDetail.characters} /></div>}

      {animeDetail?.staff.length ? (
        <div>
          <h2 className="text-base font-semibold mb-2">Staff</h2>
          <div className="grid grid-cols-2 gap-2">
            {animeDetail.staff.map((person, index) => {
              const staffImgSrc = person.image
                ? toCachedImageSrc(person.image, 'anilist') || person.image
                : null;

              return (
                <Link
                  key={`${person.id}-${person.role}-${index}`}
                  href={`/anime/staff/${person.id}`}
                  className="flex items-center gap-2 rounded-lg border border-border/30 bg-muted/20 p-2 hover:border-primary/40 transition-colors"
                >
                  <div className="relative w-10 h-10 rounded-full overflow-hidden bg-muted shrink-0">
                    {staffImgSrc ? (
                      <FadeInImage
                        src={staffImgSrc}
                        alt={person.name}
                        fill
                        sizes="40px"
                        className="object-cover"
                        unoptimized={isProtectedApiImageSrc(staffImgSrc)}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[10px]">
                        ?
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{person.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{person.role}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      {animeDetail?.rankings.length ? (
        <div>
          <h2 className="text-base font-semibold mb-2">Rankings</h2>
          <div className="space-y-1.5">
            {animeDetail.rankings.map((ranking) => (
              <div
                key={ranking.id}
                className="flex items-center gap-2 rounded-lg border border-border/30 bg-muted/20 px-3 py-2"
              >
                {ranking.type === 'RATED' ? (
                  <Trophy className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                ) : (
                  <TrendingUp className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                )}
                <span className="text-sm">
                  <span className="font-semibold">#{ranking.rank}</span> {formatAniListRankingLabel(ranking)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {animeStatusDistribution.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-2">Status Distribution</h2>
          {totalStatusUsers > 0 && (
            <div className="flex h-3 rounded-full overflow-hidden mb-3">
              {animeStatusDistribution.map((entry) => (
                <div
                  key={entry.status}
                  className={STATUS_COLORS[entry.status] || 'bg-gray-500'}
                  style={{ width: `${(entry.amount / totalStatusUsers) * 100}%` }}
                />
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {animeStatusDistribution.map((entry) => (
              <div key={entry.status} className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_COLORS[entry.status] || 'bg-gray-500'}`} />
                <div className="text-sm">
                  <span className="text-muted-foreground">{STATUS_LABELS[entry.status] || entry.status}</span>
                  <span className="ml-1.5 font-medium">{entry.amount.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {animeScoreDistribution.length > 0 && maxScoreAmount > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-2">Score Distribution</h2>
          <div className="flex items-end gap-1 h-28">
            {[...animeScoreDistribution]
              .sort((a, b) => a.score - b.score)
              .map((entry) => {
                const height = (entry.amount / maxScoreAmount) * 100;
                const barColor = entry.score >= 70
                  ? 'bg-green-500'
                  : entry.score >= 50
                    ? 'bg-yellow-500'
                    : 'bg-red-500';

                return (
                  <div key={entry.score} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">{entry.amount > 0 ? entry.amount.toLocaleString() : ''}</span>
                    <div className="w-full flex items-end" style={{ height: '80px' }}>
                      <div
                        className={`w-full rounded-t-sm ${barColor}`}
                        style={{ height: `${Math.max(height, 2)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{entry.score}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {animeDetail && <div><AnimeRelationsSection relations={animeDetail.relations} /></div>}
      {animeDetail && <AnimeMediaRail title="Recommendations" items={animeDetail.recommendations} />}

      {(animeLinks.length > 0 || jellyfinLink) && (
        <div>
          <h2 className="text-base font-semibold mb-2">External Links</h2>
          <div className="flex flex-wrap gap-2">
            {jellyfinLink && (
              <button
                onClick={jellyfinLink.onOpen}
                disabled={jellyfinLink.loading}
                className="inline-flex items-center gap-1 rounded-lg border border-border/30 bg-muted/30 px-3 py-1.5 text-sm text-primary hover:bg-muted/50 transition-colors disabled:opacity-50"
              >
                {jellyfinLink.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                Open in Jellyfin
              </button>
            )}
            {animeLinks.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-border/30 bg-muted/30 px-3 py-1.5 text-sm text-primary hover:bg-muted/50 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                {link.label}
              </a>
            ))}
            {animeDetail && animeDetail.externalLinks && animeDetail.externalLinks?.length > 0 && animeDetail.externalLinks.filter((link) => link.url).map((link) => (
              <a
                key={link.id}
                href={link.url!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-border/30 bg-muted/30 px-3 py-1.5 text-sm text-primary hover:bg-muted/50 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                {link.site}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
