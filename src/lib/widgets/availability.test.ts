import { describe, expect, it } from 'vitest';
import { describeRequiredWidgetServices, hasRequiredWidgetServices, widgetServiceSetupPath } from './availability';
import type { WidgetDefinition, WidgetService } from './types';

const configured = new Set<WidgetService>(['SONARR', 'JELLYFIN']);

function requirement(
  requiredServices?: WidgetService[],
  requiredServiceMode?: WidgetDefinition['requiredServiceMode'],
) {
  return { requiredServices, requiredServiceMode };
}

describe('hasRequiredWidgetServices', () => {
  it('allows widgets without service requirements', () => {
    expect(hasRequiredWidgetServices(requirement(), configured)).toBe(true);
  });

  it('requires every service by default and in all mode', () => {
    expect(hasRequiredWidgetServices(requirement(['SONARR', 'JELLYFIN']), configured)).toBe(true);
    expect(hasRequiredWidgetServices(requirement(['SONARR', 'RADARR']), configured)).toBe(false);
    expect(
      hasRequiredWidgetServices(requirement(['SONARR', 'RADARR'], 'all'), configured),
    ).toBe(false);
  });

  it('supports explicit any-service requirements', () => {
    expect(
      hasRequiredWidgetServices(requirement(['RADARR', 'JELLYFIN'], 'any'), configured),
    ).toBe(true);
    expect(
      hasRequiredWidgetServices(requirement(['RADARR', 'PROWLARR'], 'any'), configured),
    ).toBe(false);
  });
});

describe('describeRequiredWidgetServices', () => {
  it('names services the way people know them', () => {
    expect(describeRequiredWidgetServices(requirement(['QBITTORRENT']))).toBe('qBittorrent');
    expect(describeRequiredWidgetServices(requirement(['SONARR', 'RADARR'], 'any'))).toBe('Sonarr or Radarr');
    expect(describeRequiredWidgetServices(requirement(['JELLYFIN', 'TMDB']))).toBe('Jellyfin and TMDB');
  });
});

describe('widgetServiceSetupPath', () => {
  it('leads to the first missing service', () => {
    expect(widgetServiceSetupPath(requirement(['SONARR', 'QBITTORRENT']), configured)).toBe('/settings/instances/qbittorrent');
    expect(widgetServiceSetupPath(requirement(['YOUTUBE']), configured)).toBe('/settings/instances');
  });

  it('leads to the first listed service in any mode', () => {
    expect(widgetServiceSetupPath(requirement(['RADARR', 'LIDARR'], 'any'), configured)).toBe('/settings/instances/radarr');
  });

  it('has nowhere to go when nothing is missing', () => {
    expect(widgetServiceSetupPath(requirement(['SONARR']), configured)).toBeNull();
    expect(widgetServiceSetupPath(requirement(), configured)).toBeNull();
  });
});
