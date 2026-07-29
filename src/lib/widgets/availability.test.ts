import { describe, expect, it } from 'vitest';
import { hasRequiredWidgetServices } from './availability';
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
