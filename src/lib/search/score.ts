import { normalizeTitle, normalizeTitleKey } from '@/lib/discover';
import {
  SEARCH_MODULE_ORDER,
  type SearchDoc,
  type SearchModule,
  type SearchResult,
  type SearchResultRef,
} from '@/lib/search/types';

// Deterministic, tiered scoring + cross-module dedup. No ML, no fuzzy beyond
// normalization + multi-token containment — kept simple per the plan; revisit
// only if results feel wrong in practice.

export function normalizeQuery(q: string): string {
  return normalizeTitle(q);
}

/**
 * Score a doc against an already-normalized query. Tiers (high→low): exact title >
 * whole-title prefix > token prefix > substring > all-tokens contained. Returns 0
 * when nothing matches so the caller drops it.
 */
export function score(nq: string, doc: SearchDoc): number {
  const title = doc.sortTitle; // normalizeTitle() applied at index time
  if (!nq || !title) return 0;

  if (title === nq) return 1000;
  if (title.startsWith(nq)) return 850 - Math.min(title.length - nq.length, 200);

  const tokens = title.split(' ');
  if (tokens.some((t) => t.startsWith(nq))) return 650;

  const idx = title.indexOf(nq);
  if (idx >= 0) return 450 - Math.min(idx, 200);

  const qTokens = nq.split(' ').filter(Boolean);
  if (qTokens.length > 1 && qTokens.every((qt) => title.includes(qt))) return 300;

  return 0;
}

/** Canonical keys for dedup: tmdb → tvdb → imdb → anilist → normalized title+year.
 * Music artists key on MusicBrainz id (or title) under a `music:` namespace so a
 * band never collapses into a same-named film. A doc emits every id key it has so
 * union-find can bridge two records that each expose a different id for one title. */
function canonicalKeys(doc: SearchDoc): string[] {
  if (doc.module === 'music') {
    return [`music:${doc.ids.mbid ?? normalizeTitleKey(doc.title, null)}`];
  }
  const keys: string[] = [];
  if (doc.ids.tmdb) keys.push(`tmdb:${doc.ids.tmdb}`);
  if (doc.ids.tvdb) keys.push(`tvdb:${doc.ids.tvdb}`);
  if (doc.ids.imdb) keys.push(`imdb:${doc.ids.imdb.toLowerCase()}`);
  if (doc.ids.anilist) keys.push(`anilist:${doc.ids.anilist}`);
  if (keys.length === 0) keys.push(`title:${normalizeTitleKey(doc.title, doc.year)}`);
  return keys;
}

const modulePriority = (m: SearchModule) => SEARCH_MODULE_ORDER.indexOf(m);

/**
 * Score every doc, drop non-matches, collapse docs that share any canonical key into
 * one result carrying every module it appears in, then sort and slice to `limit`.
 */
export function mergeAndRank(
  docsByModule: Record<string, SearchDoc[]>,
  query: string,
  limit: number
): SearchResult[] {
  const nq = normalizeQuery(query);

  const scored: { doc: SearchDoc; score: number }[] = [];
  for (const docs of Object.values(docsByModule)) {
    for (const doc of docs) {
      const s = score(nq, doc);
      if (s > 0) scored.push({ doc, score: s });
    }
  }
  if (scored.length === 0) return [];

  // Union-find over docs that share any canonical key.
  const parent = scored.map((_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const keyToIndex = new Map<string, number>();
  scored.forEach((entry, i) => {
    for (const key of canonicalKeys(entry.doc)) {
      const existing = keyToIndex.get(key);
      if (existing === undefined) keyToIndex.set(key, i);
      else union(existing, i);
    }
  });

  const groups = new Map<number, { doc: SearchDoc; score: number }[]>();
  scored.forEach((entry, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(entry);
    else groups.set(root, [entry]);
  });

  const results: SearchResult[] = [];
  for (const group of groups.values()) {
    // Best doc: highest score, then has-poster, then highest-priority module.
    const best = group.reduce((a, b) => {
      if (b.score !== a.score) return b.score > a.score ? b : a;
      const ap = a.doc.poster ? 1 : 0;
      const bp = b.doc.poster ? 1 : 0;
      if (ap !== bp) return bp > ap ? b : a;
      return modulePriority(b.doc.module) < modulePriority(a.doc.module) ? b : a;
    });

    // One ref per module, in priority order; first doc of each module wins its route
    // (listConnections returns the default instance first, so that's what we link to).
    const modules: SearchResultRef[] = [];
    for (const m of SEARCH_MODULE_ORDER) {
      const d = group.find((e) => e.doc.module === m);
      if (d) modules.push({ module: m, route: d.doc.route });
    }

    results.push({
      id: best.doc.id,
      title: best.doc.title,
      subtitle: best.doc.subtitle,
      year: best.doc.year,
      poster: best.doc.poster ?? null,
      posterService: best.doc.posterService,
      modules,
      score: best.score,
    });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ap = a.poster ? 1 : 0;
    const bp = b.poster ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return a.title.localeCompare(b.title);
  });

  return results.slice(0, limit);
}
