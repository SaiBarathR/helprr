/** The Radarr film fields that say when a film is out. */
export interface FilmReleaseFields {
  status?: string;
  inCinemas?: string;
  digitalRelease?: string;
  physicalRelease?: string;
}

export type FilmRelease = { label: 'In cinemas' | 'Digital release' | 'Physical release'; date: Date };

export function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A film's known releases, oldest first, split into those that have happened
 * and those still to come. The one place Helprr decides whether a missing film
 * is out: Activity → Missing's "Not released yet" group, the row's date and
 * Radarr's Search all read it.
 */
export function filmReleases(film: FilmReleaseFields, now: number): { past: FilmRelease[]; future: FilmRelease[] } {
  const releases = ([
    ['In cinemas', film.inCinemas],
    ['Digital release', film.digitalRelease],
    ['Physical release', film.physicalRelease],
  ] as const)
    .map(([label, value]) => ({ label, date: validDate(value) }))
    .filter((r): r is FilmRelease => r.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return {
    past: releases.filter((r) => r.date.getTime() <= now),
    future: releases.filter((r) => r.date.getTime() > now),
  };
}

/**
 * A film that is not out anywhere yet: none of its cinema, digital or physical
 * dates has passed (with no dates at all: Radarr's status says it is only
 * announced). Radarr's own isAvailable is not used: with minimum availability
 * "announced" it is true for films years from release.
 */
export function isFilmNotReleased(film: FilmReleaseFields, now = Date.now()): boolean {
  const { past, future } = filmReleases(film, now);
  if (past.length > 0) return false;
  return future.length > 0 || film.status === 'announced' || film.status === 'tba';
}

/** The film's next release still to come (its label and date), or null. */
export function nextFilmRelease(film: FilmReleaseFields, now = Date.now()): FilmRelease | null {
  return filmReleases(film, now).future[0] ?? null;
}
