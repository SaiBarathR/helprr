import { describe, expect, it } from 'vitest';
import { STATIC_WIDGET_LOADER_IDS, getWidgetComponent } from '@/components/widgets/widget-loaders';
import { ALL_WIDGET_DEFINITIONS } from './definitions';
import {
  DEFAULT_DESKTOP_LAYOUT,
  DEFAULT_MEMBER_DESKTOP_LAYOUT,
  DEFAULT_MEMBER_MOBILE_LAYOUT,
  DEFAULT_MOBILE_LAYOUT,
  buildDiscoverWidgetDefinitions,
  getWidgetDefinition,
} from './registry';

describe('widget loader registry', () => {
  it('has exactly one loader for every static metadata definition', () => {
    const metadataIds = ALL_WIDGET_DEFINITIONS.map(({ id }) => id).sort();
    const loaderIds = [...STATIC_WIDGET_LOADER_IDS].sort();

    expect(loaderIds).toEqual(metadataIds);
    expect(new Set(loaderIds).size).toBe(loaderIds.length);
    expect(ALL_WIDGET_DEFINITIONS.every((definition) => !('component' in definition))).toBe(true);
  });

  it('keeps every existing default layout renderable without migration', () => {
    const savedLayouts = [
      DEFAULT_DESKTOP_LAYOUT,
      DEFAULT_MOBILE_LAYOUT,
      DEFAULT_MEMBER_DESKTOP_LAYOUT,
      DEFAULT_MEMBER_MOBILE_LAYOUT,
    ];

    for (const layout of savedLayouts) {
      for (const instance of layout) {
        expect(getWidgetDefinition(instance.widgetId)).toBeDefined();
        expect(getWidgetComponent(instance.widgetId)).toBeDefined();
      }
    }
  });

  it('resolves configured discover sections without putting them in the static map', () => {
    const discoverLayout = {
      sections: [{
        id: 'custom-example',
        type: 'custom' as const,
        label: 'Custom Example',
        enabled: true,
        order: 0,
        mediaType: 'movie' as const,
        filters: {},
      }],
    };
    const [definition] = buildDiscoverWidgetDefinitions(discoverLayout);

    expect(definition?.id).toBe('discover-custom-example');
    expect(getWidgetComponent('discover-custom-example')).toBeDefined();
    expect(STATIC_WIDGET_LOADER_IDS).not.toContain('discover-custom-example');
  });
});
