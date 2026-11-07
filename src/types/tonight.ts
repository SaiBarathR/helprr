import type { RandomPick } from './library';

/** The Random filters a Tonight pick was started with. */
export interface TonightFilters {
  type: 'movie' | 'series' | 'any';
  watch: 'all' | 'unwatched';
}

export interface TonightTitle extends RandomPick {
  imdbId: string | null;
  tmdbId: number | null;
  tvdbId: number | null;
}

export type TonightStatus = 'open' | 'matched' | 'noMatch' | 'ended';

export interface TonightParticipant {
  id: string;
  name: string;
  isStarter: boolean;
  joined: boolean;
  /** How many titles they have voted on (never which way). */
  voted: number;
}

/** GET /api/tonight/[id] — one viewer's view of a pick. */
export interface TonightView {
  id: string;
  status: TonightStatus;
  isStarter: boolean;
  starterName: string;
  filters: TonightFilters;
  narrowed: boolean;
  titles: TonightTitle[];
  /** The viewer's own votes, keyed by title index. */
  myVotes: Record<string, boolean>;
  participants: TonightParticipant[];
  winnerIndex: number | null;
  /** With no match: the titles closest to one, by how many said yes. */
  nearMisses: { index: number; yes: number }[];
  expiresAt: string;
}

export interface TonightMember {
  id: string;
  name: string;
}
