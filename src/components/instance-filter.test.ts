import { describe, expect, it } from 'vitest';
import { appDisplayName, deriveInstances, severalInstanceLabels, withAppName } from './instance-filter';

describe('withAppName', () => {
  it('names the app so same-named instances can be told apart', () => {
    expect(withAppName('main', 'SONARR')).toBe('main (Sonarr)');
    expect(withAppName('main', 'radarr')).toBe('main (Radarr)');
  });

  it('leaves a label that already names its app', () => {
    expect(withAppName('sonarr-anime', 'sonarr')).toBe('sonarr-anime');
  });

  it('shows the app name for a label that is just the type', () => {
    expect(withAppName('SONARR', 'SONARR')).toBe('Sonarr');
    expect(withAppName('QBITTORRENT', 'QBITTORRENT')).toBe('qBittorrent');
  });

  it('names non-arr services too', () => {
    expect(withAppName('main', 'jellyfin')).toBe('main (Jellyfin)');
  });

  it('leaves the label alone when the app is unknown', () => {
    expect(withAppName('main')).toBe('main');
    expect(withAppName('main', 'plex')).toBe('main');
  });
});

describe('appDisplayName', () => {
  it("writes a row's source as the instance chips write the app, so one list doesn't mix \"lidarr\" and \"Radarr\"", () => {
    expect(appDisplayName('lidarr')).toBe('Lidarr');
    expect(appDisplayName('SONARR')).toBe('Sonarr');
    expect(appDisplayName('plex')).toBe('plex');
  });
});

describe('deriveInstances', () => {
  it('lists each instance once, with its app when asked', () => {
    const items = [
      { instanceId: 's1', instanceLabel: 'main', type: 'episode' },
      { instanceId: 'r1', instanceLabel: 'main', type: 'movie' },
      { instanceId: 's1', instanceLabel: 'main', type: 'episode' },
    ];
    const app = (item: (typeof items)[number]) => (item.type === 'episode' ? 'sonarr' : 'radarr');
    expect(deriveInstances(items, app)).toEqual([
      { id: 's1', label: 'main (Sonarr)' },
      { id: 'r1', label: 'main (Radarr)' },
    ]);
    expect(deriveInstances(items)[0]).toEqual({ id: 's1', label: 'main' });
  });
});

describe('severalInstanceLabels', () => {
  it('names the instances of an app that has several, and leaves single ones to the app chip', () => {
    const labels = severalInstanceLabels([
      { id: 'r1', label: 'RADARR', type: 'RADARR' },
      { id: 'r2', label: 'radarr-anime', type: 'RADARR' },
      { id: 's1', label: 'main', type: 'SONARR' },
    ]);
    expect([...labels]).toEqual([['r1', 'Radarr'], ['r2', 'radarr-anime']]);
  });
});
