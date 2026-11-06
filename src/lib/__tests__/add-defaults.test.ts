// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { pickRememberedOption, readAddDefaults, saveAddDefaults } from '@/lib/add-defaults';

beforeEach(() => localStorage.clear());

describe('add defaults', () => {
  it('keeps each service and instance separate', () => {
    saveAddDefaults('sonarr', 'a', { profileId: '7', rootFolder: '/tv' });
    saveAddDefaults('radarr', 'a', { profileId: '3' });

    expect(readAddDefaults('sonarr', 'a')).toEqual({ profileId: '7', rootFolder: '/tv' });
    expect(readAddDefaults('radarr', 'a')).toEqual({ profileId: '3' });
    expect(readAddDefaults('sonarr', 'b')).toEqual({});
  });

  it('reads nothing without an instance or from malformed storage', () => {
    saveAddDefaults('sonarr', undefined, { profileId: '7' });
    expect(readAddDefaults('sonarr', undefined)).toEqual({});
    expect(localStorage.length).toBe(0);

    localStorage.setItem('helprr-add-defaults:sonarr:a', '{not json');
    expect(readAddDefaults('sonarr', 'a')).toEqual({});
    localStorage.setItem('helprr-add-defaults:sonarr:a', JSON.stringify({ profileId: 7, rootFolder: '/tv', extra: 'x' }));
    expect(readAddDefaults('sonarr', 'a')).toEqual({ rootFolder: '/tv' });
  });

  it('uses the remembered option only while it still exists', () => {
    expect(pickRememberedOption(['1', '2'], '2')).toBe('2');
    expect(pickRememberedOption(['1', '2'], '9')).toBe('1');
    expect(pickRememberedOption(['1', '2'], undefined)).toBe('1');
  });
});
