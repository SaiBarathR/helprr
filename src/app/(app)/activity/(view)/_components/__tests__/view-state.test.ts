// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NAVIGATION_START_EVENT } from '@/lib/route-scroll-state';
import { activityLinkView, isSortKey, isTabKey, writeActivityLinkView } from '../view-state';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('activity view state', () => {
  it('accepts only known tabs and sort keys', () => {
    expect(['queue', 'failed', 'missing', 'cutoff'].every(isTabKey)).toBe(true);
    expect(isTabKey('history')).toBe(false);
    expect(['title', 'progress', 'timeleft', 'size'].every(isSortKey)).toBe(true);
    expect(isSortKey('added')).toBe(false);
  });

  it('reads the view a link asks for', () => {
    const view = (query: string) => activityLinkView(new URLSearchParams(query));
    expect(view('')).toBeNull();
    expect(view('source=sonarr')).toEqual({ sources: ['sonarr'], instance: 'all' });
    expect(view('source=sonarr,bogus,all,radarr&instance=i2')).toEqual({ sources: ['sonarr', 'radarr'], instance: 'i2' });
    expect(view('source=all')).toEqual({ sources: [], instance: 'all' });
    expect(view('source=bogus')).toBeNull();
  });

  it('writes a view into the current entry without scrolling, and drops it', () => {
    window.history.replaceState(null, '', '/activity?tab=queue&source=sonarr&instance=i1');
    const events: unknown[] = [];
    const listener = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener(NAVIGATION_START_EVENT, listener);
    const replace = vi.spyOn(window.history, 'replaceState');
    try {
      writeActivityLinkView({ sources: ['sonarr', 'lidarr'], instance: 'i2' });
      expect(window.location.pathname + window.location.search).toBe('/activity?tab=queue&source=sonarr%2Clidarr&instance=i2');
      writeActivityLinkView({ sources: [], instance: 'all' });
      expect(window.location.search).toBe('?tab=queue&source=all');
      writeActivityLinkView(null);
      expect(window.location.search).toBe('?tab=queue');
      expect(events).toEqual([
        { kind: 'replace', href: '/activity?tab=queue&source=sonarr%2Clidarr&instance=i2', preserveScroll: true },
        { kind: 'replace', href: '/activity?tab=queue&source=all', preserveScroll: true },
        { kind: 'replace', href: '/activity?tab=queue', preserveScroll: true },
      ]);
      expect(replace).toHaveBeenCalledTimes(3);
    } finally {
      window.removeEventListener(NAVIGATION_START_EVENT, listener);
      replace.mockRestore();
    }
  });
});
