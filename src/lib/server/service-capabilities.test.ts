import { describe, expect, it } from 'vitest';
import type { PermissionUser } from '@/lib/permissions';
import { filterVisibleServiceTypes } from './service-capabilities';

const allServices = [
  'SONARR',
  'RADARR',
  'LIDARR',
  'QBITTORRENT',
  'PROWLARR',
  'JELLYFIN',
  'TMDB',
  'ANILIST',
  'SEERR',
] as const;

describe('filterVisibleServiceTypes', () => {
  it('does not expose configured services hidden by the current user capabilities', () => {
    const user: PermissionUser = {
      role: 'member',
      template: 'member',
      permissions: {
        'series.view': false,
        'movies.view': false,
        'music.view': false,
        'jellyfin.view': false,
        'discover.view': false,
        'anime.view': false,
        'requests.view': false,
        'activity.view': false,
        'cleanup.view': false,
        'jellyfin.control': false,
        'jellyfin.sessions': false,
        'jellyfin.stats': false,
        'recommendations.view': false,
        'requests.approve': false,
      },
    };

    expect(filterVisibleServiceTypes(user, allServices)).toEqual([]);
  });

  it('keeps every configured service visible to an administrator', () => {
    const user: PermissionUser = {
      role: 'admin',
      template: 'admin',
      permissions: {},
    };

    expect(filterVisibleServiceTypes(user, allServices)).toEqual(allServices);
  });

  it('keeps services needed by independently grantable widget capabilities', () => {
    const user: PermissionUser = {
      role: 'member',
      template: 'member',
      permissions: {
        'torrents.view': false,
        'cleanup.view': true,
        'jellyfin.view': false,
        'jellyfin.stats': true,
        'requests.view': false,
        'requests.approve': true,
      },
    };

    expect(
      filterVisibleServiceTypes(user, ['QBITTORRENT', 'JELLYFIN', 'SEERR']),
    ).toEqual(['QBITTORRENT', 'JELLYFIN', 'SEERR']);
  });
});
