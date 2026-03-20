'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { PageSpinner } from '@/components/ui/page-spinner';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import {
  User,
  Star,
  Film,
  Tv,
  ExternalLink,
  Calendar,
  MapPin,
  Briefcase,
  ArrowUpDown,
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
} from 'lucide-react';

interface PersonCredit {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  releaseDate: string | null;
  year: number | null;
  rating: number;
  voteCount: number;
  popularity: number;
  character: string | null;
  department: string | null;
  job: string | null;
  episodeCount: number | null;
}

interface PersonData {
  id: number;
  name: string;
  biography: string;
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
  profilePath: string | null;
  knownForDepartment: string;
  alsoKnownAs: string[];
  homepage: string | null;
  popularity: number;
  gender: number;
  externalIds: {
    imdbId: string | null;
    facebookId: string | null;
    instagramId: string | null;
    twitterId: string | null;
    tiktokId: string | null;
    youtubeId: string | null;
  };
  castCredits: PersonCredit[];
  crewCredits: PersonCredit[];
}

type Department = 'Acting' | 'Production' | 'Crew' | 'Writing' | 'Directing';
type MediaFilter = 'all' | 'movie' | 'tv';
type SortKey = 'voteCount' | 'releaseDate' | 'year' | 'popularity' | 'episodeCount' | 'rating';
type SortDir = 'desc' | 'asc';

const DEPARTMENTS: Department[] = ['Acting', 'Production', 'Crew', 'Writing', 'Directing'];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'voteCount', label: 'Votes' },
  { key: 'rating', label: 'Rating' },
  { key: 'releaseDate', label: 'Release Date' },
  { key: 'year', label: 'Year' },
  { key: 'popularity', label: 'Popularity' },
  { key: 'episodeCount', label: 'Episodes' },
];

function formatDate(dateStr: string | null) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function calcAge(birthday: string | null, deathday: string | null) {
  if (!birthday) return null;
  const birth = new Date(birthday);
  const end = deathday ? new Date(deathday) : new Date();
  let age = end.getFullYear() - birth.getFullYear();
  const m = end.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && end.getDate() < birth.getDate())) age--;
  return age;
}

export default function PersonDetailPage() {
  const { id } = useParams();
  const personId = Number(id);
  const [person, setPerson] = useState<PersonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [department, setDepartment] = useState<Department | null>(null);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('voteCount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showSortMenu, setShowSortMenu] = useState(false);

  const loadPerson = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setPerson(null);
    setError(null);

    if (!Number.isFinite(personId) || personId <= 0) {
      setError('Invalid person ID');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/discover/person?id=${personId}`, { signal });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to load person');
      }
      const data = await res.json();
      if (signal.aborted) return;
      setPerson(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Failed to load person');
    } finally {
      if (signal.aborted) return;
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPerson(controller.signal);
    return () => controller.abort();
  }, [loadPerson]);

  // Combine cast + crew into a unified list with normalized departments
  const allCredits = useMemo(() => {
    if (!person) return [];
    const cast = person.castCredits.map((c) => ({
      ...c,
      department: 'Acting' as Department,
    }));
    const crew = person.crewCredits.map((c) => ({
      ...c,
      department: (c.department || 'Crew') as Department,
    }));
    return [...cast, ...crew];
  }, [person]);

  // Count per department
  const departmentCounts = useMemo(() => {
    const counts: Record<Department, number> = { Acting: 0, Production: 0, Crew: 0, Writing: 0, Directing: 0 };
    for (const c of allCredits) {
      if (c.department in counts) counts[c.department as Department]++;
    }
    return counts;
  }, [allCredits]);

  // Auto-select department with highest count on first load
  const activeDepartment = useMemo(() => {
    if (department !== null) return department;
    let best: Department = 'Acting';
    let max = 0;
    for (const dept of DEPARTMENTS) {
      if (departmentCounts[dept] > max) {
        max = departmentCounts[dept];
        best = dept;
      }
    }
    return best;
  }, [department, departmentCounts]);

  const filteredCredits = useMemo(() => {
    let list = allCredits.filter((c) => c.department === activeDepartment);
    if (mediaFilter !== 'all') list = list.filter((c) => c.mediaType === mediaFilter);
    const dir = sortDir === 'desc' ? 1 : -1;
    list.sort((a, b) => {
      let diff = 0;
      switch (sortKey) {
        case 'voteCount':
          diff = (b.voteCount ?? 0) - (a.voteCount ?? 0); break;
        case 'rating':
          diff = (b.rating ?? 0) - (a.rating ?? 0); break;
        case 'popularity':
          diff = (b.popularity ?? 0) - (a.popularity ?? 0); break;
        case 'episodeCount':
          diff = (b.episodeCount ?? 0) - (a.episodeCount ?? 0); break;
        case 'year':
          diff = (b.year ?? 0) - (a.year ?? 0); break;
        case 'releaseDate': {
          const da = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
          const db = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
          diff = db - da; break;
        }
      }
      return diff * dir;
    });
    return list;
  }, [allCredits, activeDepartment, mediaFilter, sortKey, sortDir]);

  const creditCards = useMemo(() => filteredCredits.map((credit) => {
    const posterSrc = credit.posterPath
      ? toCachedImageSrc(credit.posterPath, 'tmdb')
      : null;
    return (
      <Link
        href={`/discover/${credit.mediaType === 'movie' ? 'movie' : 'tv'}/${credit.id}`}
        key={`${credit.mediaType}-${credit.id}-${credit.job || credit.character || ''}`}
        className="group text-left"
      >
        <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted/60 border border-border/40">
          {posterSrc ? (
            <Image
              src={posterSrc}
              alt={credit.title}
              fill
              sizes="(max-width: 640px) 33vw, (max-width: 1200px) 18vw, 150px"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              unoptimized={isProtectedApiImageSrc(posterSrc)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              {credit.mediaType === 'movie' ? <Film className="h-6 w-6" /> : <Tv className="h-6 w-6" />}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
          <div className="absolute top-1.5 left-1.5 flex items-center justify-center h-5 w-5 rounded-md bg-black/60">
            {credit.mediaType === 'movie'
              ? <Film className="h-3 w-3 text-blue-400" />
              : <Tv className="h-3 w-3 text-violet-400" />}
          </div>
          <div className="absolute bottom-0 left-0 right-0 p-1.5">
            <p className="text-[10px] text-white font-medium line-clamp-2 leading-tight">{credit.title}</p>
            <div className="mt-0.5 flex items-center justify-between text-[9px] text-white/80">
              <span>{credit.year ?? '----'}</span>
              {credit.rating > 0 && (
                <span className="inline-flex items-center gap-0.5">
                  <Star className="h-2 w-2 fill-yellow-400 text-yellow-400" />
                  {credit.rating.toFixed(1)}
                </span>
              )}
            </div>
          </div>
        </div>
        {(credit.character || credit.job) && (
          <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1 leading-tight px-0.5">
            {credit.character || credit.job}
            {credit.episodeCount ? ` (${credit.episodeCount} ep)` : ''}
          </p>
        )}
      </Link>
    );
  }), [filteredCredits]);

  if (loading) {
    return <><PageHeader title="Person" /><PageSpinner /></>;
  }

  if (error || !person) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {error || 'Person not found'}
      </div>
    );
  }

  const profileSrc = person.profilePath
    ? toCachedImageSrc(person.profilePath, 'tmdb')
    : null;
  const age = calcAge(person.birthday, person.deathday);

  const socialLinks: { label: string; url: string; icon: string }[] = [];
  if (person.externalIds.imdbId) {
    socialLinks.push({ label: 'IMDb', url: `https://www.imdb.com/name/${person.externalIds.imdbId}`, icon: 'IMDb' });
  }
  if (person.externalIds.instagramId) {
    socialLinks.push({ label: 'Instagram', url: `https://instagram.com/${person.externalIds.instagramId}`, icon: 'IG' });
  }
  if (person.externalIds.twitterId) {
    socialLinks.push({ label: 'X / Twitter', url: `https://x.com/${person.externalIds.twitterId}`, icon: 'X' });
  }
  if (person.externalIds.facebookId) {
    socialLinks.push({ label: 'Facebook', url: `https://facebook.com/${person.externalIds.facebookId}`, icon: 'FB' });
  }
  if (person.externalIds.tiktokId) {
    socialLinks.push({ label: 'TikTok', url: `https://tiktok.com/@${person.externalIds.tiktokId}`, icon: 'TT' });
  }
  if (person.externalIds.youtubeId) {
    socialLinks.push({ label: 'YouTube', url: `https://youtube.com/@${person.externalIds.youtubeId}`, icon: 'YT' });
  }
  if (person.homepage) {
    socialLinks.push({ label: 'Website', url: person.homepage, icon: 'WEB' });
  }

  return (
    <>
      <PageHeader title={person.name} />

      <div className="space-y-5 animate-content-in">
        {/* Profile hero */}
        <div className="flex gap-4">
          <div className="relative w-[120px] h-[120px] rounded-full overflow-hidden bg-muted shrink-0">
            {profileSrc ? (
              <Image
                src={profileSrc}
                alt={person.name}
                fill
                sizes="120px"
                className="object-cover"
                unoptimized={isProtectedApiImageSrc(profileSrc)}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <User className="h-12 w-12" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <h1 className="text-xl font-bold leading-tight">{person.name}</h1>
            {person.knownForDepartment && (
              <div className="flex items-center gap-1.5 mt-1">
                <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{person.knownForDepartment}</span>
              </div>
            )}
            {person.birthday && (
              <div className="flex items-center gap-1.5 mt-1">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {formatDate(person.birthday)}
                  {age != null && ` (${age}${person.deathday ? ', deceased' : ''})`}
                </span>
              </div>
            )}
            {person.placeOfBirth && (
              <div className="flex items-center gap-1.5 mt-1">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground line-clamp-1">{person.placeOfBirth}</span>
              </div>
            )}
          </div>
        </div>

        {/* Social links */}
        {socialLinks.length > 0 && (
          <div className="flex gap-2 overflow-x-auto -mx-2 px-2 md:-mx-6 md:px-6 scrollbar-hide">
            {socialLinks.map((link) => (
              <a
                key={link.label}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/60 bg-accent/40 text-xs font-semibold"
              >
                <span>{link.icon}</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        )}

        {/* Biography */}
        {person.biography && (
          <div>
            <h2 className="text-base font-semibold mb-1">Biography</h2>
            <div className="relative">
              <p
                className={`text-sm text-muted-foreground leading-relaxed ${
                  !bioExpanded ? 'line-clamp-4' : ''
                }`}
              >
                {person.biography}
              </p>
              {person.biography.length > 200 && (
                <button
                  onClick={() => setBioExpanded(!bioExpanded)}
                  className="text-sm text-primary font-medium mt-1"
                >
                  {bioExpanded ? 'less' : 'more...'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Also known as */}
        {person.alsoKnownAs.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-1">Also known as</h2>
            <p className="text-sm text-muted-foreground">{person.alsoKnownAs.join(', ')}</p>
          </div>
        )}

        {/* Credits */}
        <div className="space-y-3">
          <div className="px-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Filmography</h2>
              {/* Sort controls */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setSortDir((d) => d === 'desc' ? 'asc' : 'desc')}
                  className="flex items-center justify-center h-7 w-7 rounded-lg bg-accent/50 text-muted-foreground"
                  title={sortDir === 'desc' ? 'Descending' : 'Ascending'}
                >
                  {sortDir === 'desc'
                    ? <ArrowDownNarrowWide className="h-3.5 w-3.5" />
                    : <ArrowUpNarrowWide className="h-3.5 w-3.5" />}
                </button>
                <div className="relative">
                  <button
                    onClick={() => setShowSortMenu(!showSortMenu)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-accent/50 text-muted-foreground"
                  >
                    <ArrowUpDown className="h-3 w-3" />
                    {SORT_OPTIONS.find((o) => o.key === sortKey)?.label}
                  </button>
                  {showSortMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[140px]">
                        {SORT_OPTIONS.map((opt) => (
                          <button
                            key={opt.key}
                            onClick={() => { setSortKey(opt.key); setShowSortMenu(false); }}
                            className={`w-full text-left px-3 py-1.5 text-xs font-medium ${
                              sortKey === opt.key ? 'text-primary bg-primary/10' : 'text-foreground hover:bg-accent/50'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            {/* Department filter */}
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
              {DEPARTMENTS.map((dept) => {
                const count = departmentCounts[dept];
                if (count === 0) return null;
                return (
                  <button
                    key={dept}
                    onClick={() => setDepartment(dept)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold ${
                      activeDepartment === dept
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-accent/50 text-muted-foreground'
                    }`}
                  >
                    {dept} ({count})
                  </button>
                );
              })}
            </div>
            {/* Media type filter */}
            <div className="flex items-center gap-2">
              {(['all', 'movie', 'tv'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setMediaFilter(filter)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                    mediaFilter === filter
                      ? 'bg-primary/20 text-primary border border-primary/40'
                      : 'bg-accent/40 text-muted-foreground'
                  }`}
                >
                  {filter === 'all' ? 'All' : filter === 'movie' ? 'Movies' : 'TV Shows'}
                </button>
              ))}
            </div>
          </div>

          {/* Credits grid */}
          {filteredCredits.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No {activeDepartment.toLowerCase()} credits found
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5">
              {creditCards}
            </div>
          )}
        </div>

      </div>
    </>
  );
}
