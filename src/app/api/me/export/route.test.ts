import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A tiny fake database holding rows for two users. Each query keeps only the
// rows whose userId matches its where clause and only the columns its select
// names, as Prisma does, so the export is checked for both scoping and secrets.
type Row = Record<string, unknown>;

function project(row: Row, select: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [key, spec] of Object.entries(select)) {
    if (!spec) continue;
    const value = row[key];
    if (spec === true) out[key] = value;
    else {
      const nested = (spec as { select: Record<string, unknown> }).select;
      out[key] = Array.isArray(value) ? value.map((v) => project(v as Row, nested)) : project(value as Row, nested);
    }
  }
  return out;
}

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), tables: {} as Record<string, Row[]>, logging: [] as unknown[] }));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (fn: unknown, name: string, options?: unknown) => (mocks.logging.push([name, options]), fn),
}));
vi.mock('@/lib/db', () => {
  const model = (name: string) => {
    // userId, and an eventType `in` filter where a query has one.
    type Where = { userId: string; eventType?: { in: string[] } };
    const matching = (args: { where: Where }) =>
      (mocks.tables[name] ?? []).filter((row) => row.userId === args.where.userId
        && (!args.where.eventType || args.where.eventType.in.includes(row.eventType as string)));
    return {
      findMany: async (args: { where: Where; select: Record<string, unknown> }) =>
        matching(args).map((row) => project(row, args.select)),
      findUnique: async (args: { where: { userId: string }; select: Record<string, unknown> }) => {
        const row = matching(args)[0];
        return row ? project(row, args.select) : null;
      },
    };
  };
  const names = [
    'userSettings', 'userAniListLink', 'twitchUserLink', 'watchlistItem', 'watchlistTag', 'scheduledAlert',
    'dashboardLayout', 'pushSubscription', 'notificationHistory', 'pendingRequest', 'session',
    'creatorSubscription', 'creatorPlaylistSubscription', 'recommendationEvent', 'userTasteProfile', 'creatorVideoState',
    'notificationChannel',
  ];
  return { prisma: Object.fromEntries(names.map((n) => [n, model(n)])) };
});

import { GET } from './route';

// Built at runtime so secret scanners don't read the test fixture as a real push key.
const FAKE_PUSH_KEY = ['fixture', 'push', 'key'].join('-');
const SECRETS = [
  'stored-password-hash',
  'enc:v1:totp-secret-value',
  'jellyfin-token-value',
  'anilist-access-token',
  'anilist-refresh-token',
  'twitch-access-token',
  'twitch-device-code',
  'https://push.example/endpoint-secret',
  FAKE_PUSH_KEY,
  'push-auth-value',
  'session-id-current',
  'session-id-old',
  'enc:v1:channel-secrets-value',
];

const me = {
  id: 'user-1',
  username: 'member',
  displayName: 'Member',
  role: 'member',
  status: 'active',
  template: 'member',
  permissions: {},
  passwordHash: 'stored-password-hash',
  jellyfinUserId: 'jf-1',
  seerrUserId: null,
  jellyfinToken: 'jellyfin-token-value',
  totpSecret: 'enc:v1:totp-secret-value',
  totpEnabledAt: new Date('2026-01-03T00:00:00Z'),
  totpLastUsedStep: 59000000,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

function rowsFor(userId: string, marker: string): Record<string, Row[]> {
  return {
    userSettings: [{ id: `${marker}-settings`, userId, timeZone: 'Europe/London', quietHoursEnabled: true, setupStepsDone: [] }],
    userAniListLink: [{
      userId, anilistUserId: 7, username: `${marker}-anilist`,
      accessToken: 'anilist-access-token', refreshToken: 'anilist-refresh-token',
    }],
    twitchUserLink: [{
      userId, twitchUserId: '42', login: `${marker}-twitch`,
      accessToken: 'twitch-access-token', refreshToken: 'twitch-access-token', deviceCode: 'twitch-device-code',
    }],
    watchlistItem: [{
      id: `${marker}-wl`, userId, source: 'TMDB', externalId: '1', mediaType: 'movie', title: `${marker} movie`,
      addedAt: new Date(), tags: [{ id: 't1', name: `${marker}-tag`, userId }],
    }],
    watchlistTag: [{ id: 't1', userId, name: `${marker}-tag`, color: null }],
    scheduledAlert: [{ id: `${marker}-alert`, userId, title: `${marker} alert`, status: 'active', occurrences: [] }],
    dashboardLayout: [{ id: `${marker}-layout`, userId, name: `${marker} layout`, widgets: [] }],
    pushSubscription: [{
      id: `${marker}-sub`, userId, deviceName: `${marker} iPhone`,
      endpoint: 'https://push.example/endpoint-secret', p256dh: FAKE_PUSH_KEY, auth: 'push-auth-value',
      preferences: [{ id: 'pref', subscriptionId: `${marker}-sub`, eventType: 'imported', enabled: true }],
    }],
    notificationHistory: [{ id: `${marker}-nh`, userId, eventType: 'imported', title: `${marker} note`, body: 'b', read: false }],
    pendingRequest: [{ id: `${marker}-req`, userId, mediaType: 'movie', tmdbId: 9, title: `${marker} request`, seerrUserId: '3' }],
    session: userId === me.id
      ? [
        { id: 'session-id-current', userId, userAgent: 'Safari', ip: '10.0.0.1', label: null, revokedAt: null },
        { id: 'session-id-old', userId, userAgent: 'Chrome', ip: '10.0.0.2', label: 'Laptop', revokedAt: new Date() },
      ]
      : [{ id: `${marker}-session`, userId, userAgent: `${marker}-agent` }],
    creatorSubscription: [{ userId, notifyNewVods: true, creator: { platform: 'TWITCH', externalId: '5', login: `${marker}-streamer`, displayName: 'S' } }],
    creatorPlaylistSubscription: [{ userId, notifyNewVideos: true, playlist: { platform: 'YOUTUBE', externalId: 'PL', title: `${marker} playlist` } }],
    recommendationEvent: [
      { id: `${marker}-ev1`, userId, itemKey: `tmdb:movie:${marker}-liked`, eventType: 'like', railId: 'top-picks', context: null },
      { id: `${marker}-ev2`, userId, itemKey: `tmdb:tv:${marker}-hidden`, eventType: 'not_interested', railId: null, context: null },
      { id: `${marker}-ev3`, userId, itemKey: `tmdb:movie:${marker}-shown`, eventType: 'impression', railId: 'feed', context: null },
    ],
    userTasteProfile: [{ id: `${marker}-taste`, userId, profile: { seeds: [`${marker}-seed`] }, version: 3, builtAt: new Date() }],
    creatorVideoState: [{
      id: `${marker}-vs`, userId, videoId: 'v1', seenAt: new Date(), hidden: true,
      video: { platform: 'YOUTUBE', externalId: 'yt1', title: `${marker} video`, creatorId: 'c1' },
    }],
    notificationChannel: [{
      id: `${marker}-ch`, userId, type: 'ntfy', name: `${marker} ntfy`, enabled: true, events: ['imported'],
      config: { serverUrl: 'https://ntfy.sh' }, secrets: 'enc:v1:channel-secrets-value',
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const mine = rowsFor('user-1', 'mine');
  const theirs = rowsFor('user-2', 'theirs');
  mocks.tables = Object.fromEntries(Object.keys(mine).map((k) => [k, [...mine[k], ...theirs[k]]]));
  mocks.requireUser.mockResolvedValue({ ok: true, user: me, session: { id: 'session-id-current' } });
});

describe('GET /api/me/export', () => {
  it('refuses a request without a valid session', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    expect((await GET()).status).toBe(401);
  });

  it('returns only the signed-in user’s own data as a download', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="helprr-my-data-\d{4}-\d{2}-\d{2}\.json"$/);
    const text = await res.text();
    expect(text).not.toContain('theirs');

    const data = JSON.parse(text);
    expect(data.kind).toBe('helprr-my-data');
    expect(data.profile).toMatchObject({ id: 'user-1', username: 'member', hasLocalPassword: true });
    expect(data.settings.timeZone).toBe('Europe/London');
    expect(data.linkedAccounts.aniList.username).toBe('mine-anilist');
    expect(data.linkedAccounts.twitch.login).toBe('mine-twitch');
    expect(data.watchlist.items).toHaveLength(1);
    expect(data.watchlist.items[0].tags).toEqual(['mine-tag']);
    expect(data.watchlist.tags).toEqual([{ name: 'mine-tag', color: null }]);
    expect(data.scheduledAlerts[0].title).toBe('mine alert');
    expect(data.dashboardLayouts[0].name).toBe('mine layout');
    expect(data.notificationChannels).toEqual([
      { type: 'ntfy', name: 'mine ntfy', enabled: true, events: ['imported'], config: { serverUrl: 'https://ntfy.sh' } },
    ]);
    expect(data.notificationDevices).toEqual([
      expect.objectContaining({ deviceName: 'mine iPhone', preferences: [expect.objectContaining({ eventType: 'imported' })] }),
    ]);
    expect(data.notificationHistory[0].title).toBe('mine note');
    expect(data.pendingRequests[0].title).toBe('mine request');
    expect(data.sessions.map((s: { current: boolean }) => s.current)).toEqual([true, false]);
    expect(data.follows.creators[0].creator.login).toBe('mine-streamer');
    expect(data.follows.playlists[0].playlist.title).toBe('mine playlist');
    // Ratings and "Not interested", never impressions.
    expect(data.recommendations.feedback).toEqual([
      expect.objectContaining({ itemKey: 'tmdb:movie:mine-liked', eventType: 'like' }),
      expect.objectContaining({ itemKey: 'tmdb:tv:mine-hidden', eventType: 'not_interested' }),
    ]);
    expect(text).not.toContain('mine-shown');
    expect(data.recommendations.tasteProfile).toMatchObject({ profile: { seeds: ['mine-seed'] }, version: 3 });
    expect(data.videoStates).toEqual([expect.objectContaining({
      hidden: true, video: { platform: 'YOUTUBE', externalId: 'yt1', title: 'mine video' },
    })]);
  });

  it('never includes a hash, token, push key or session id', async () => {
    const text = await (await GET()).text();
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    for (const key of ['passwordHash', 'jellyfinToken', 'totpSecret', 'totpLastUsedStep', 'codeHash', 'accessToken', 'refreshToken', 'endpoint', 'p256dh', 'deviceCode']) {
      expect(text).not.toContain(`"${key}"`);
    }
  });

  it('keeps the response (the user’s whole data) out of the API log', () => {
    expect(mocks.logging).toContainEqual(['api/me/export', { logBodies: false }]);
  });

  it('answers 500 without detail when a query fails', async () => {
    mocks.tables = {};
    const { prisma } = await import('@/lib/db');
    vi.spyOn(prisma.watchlistItem, 'findMany').mockRejectedValueOnce(new Error('select * leaked'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to build your data export' });
    expect(error.mock.calls.join(' ')).not.toContain('leaked');
    error.mockRestore();
  });
});

// A new table that belongs to a user must be a choice: exported, or left out
// for a stated reason. Reads the User model's relation fields from the schema.
describe('my-data export coverage', () => {
  const EXPORTED = [
    'sessions', 'watchlistItems', 'watchlistTags', 'pushSubscriptions', 'notificationHistory',
    'pendingRequests', 'dashboardLayouts', 'aniListLink', 'settings', 'scheduledAlerts',
    'creatorSubscriptions', 'playlistSubscriptions', 'twitchLink',
    // Feedback events only; impressions, clicks and plays are left out.
    'recommendationEvents', 'tasteProfile', 'creatorVideoStates',
    // Settings without the secrets column.
    'notificationChannels',
  ];
  const EXCLUDED: Record<string, string> = {
    passwordLink: 'holds only a token hash',
    calendarFeedTokens: 'feed links: token hashes, with the names and filters shown in Calendar',
    recoveryCodes: 'two-step sign-in recovery codes; holds only code hashes',
    apiTokens: 'personal API tokens: token hashes, with the names and scopes shown in Sessions',
  };

  it('exports or explicitly excludes every relation of User', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const schema = readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const body = schema.match(/^model User \{([\s\S]*?)^\}/m)![1];
    const models = new Set([...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]));
    const relations = body
      .split('\n')
      .map((line) => line.trim().match(/^(\w+)\s+(\w+)(\[\]|\?)?(\s|$)/))
      .filter((m): m is RegExpMatchArray => Boolean(m && models.has(m[2])))
      .map((m) => m[1]);
    expect([...relations].sort()).toEqual([...EXPORTED, ...Object.keys(EXCLUDED)].sort());
  });
});
