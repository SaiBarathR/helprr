import { describe, expect, it, vi } from 'vitest';

// A stored request event, read back as the profile build reads events.
const rows = vi.hoisted(() => ({ positives: [] as unknown[] }));
vi.mock('@/lib/db', () => ({
  prisma: {
    recommendationEvent: {
      findMany: vi.fn(async ({ where }: { where: { eventType: unknown } }) => {
        const types = (where.eventType as { in?: string[] }).in;
        return types?.includes('request') ? rows.positives : [];
      }),
    },
  },
}));

const { collectEventSignals } = await import('../signals');
const { buildTasteProfile } = await import('../build-profile');

const NOW = new Date();
const build = async () => buildTasteProfile({
  now: NOW,
  engagedTitles: [],
  plays: [],
  playsFromPlaybackReporting: false,
  events: await collectEventSignals('u1'),
  watchlist: [],
  listedAnilistIds: [],
  sources: { jellyfin: false, playbackReporting: false, anilist: false, watchlist: false, events: true },
});

describe('a request event in the taste profile', () => {
  it("moves the profile toward the requested title's genres", async () => {
    rows.positives = [];
    expect((await build()).movie.genres).toEqual({});

    rows.positives = [{ itemKey: 'tmdb:movie:603', eventType: 'request', context: { genres: ['Science Fiction', 'Action'] }, createdAt: NOW }];
    const genres = (await build()).movie.genres;
    expect(genres['science fiction']).toBeGreaterThan(0);
    expect(genres.action).toBeGreaterThan(0);
  });

  it('teaches nothing without genres, which is why the request route looks them up', async () => {
    rows.positives = [{ itemKey: 'tmdb:movie:603', eventType: 'request', context: null, createdAt: NOW }];
    expect((await build()).movie.genres).toEqual({});
  });
});
