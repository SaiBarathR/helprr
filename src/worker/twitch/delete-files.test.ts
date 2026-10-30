import { describe, expect, it } from 'vitest';
import { insideLibrary } from './delete-files';

describe('insideLibrary', () => {
  it('resolves a normal path', () => {
    expect(insideLibrary('a/Season 2026/x.mkv', '/media/twitch')).toBe('/media/twitch/a/Season 2026/x.mkv');
  });

  it.each(['../secret', 'a/../../etc/passwd', '/etc/passwd', '.', ''])('refuses %s', (relative) => {
    expect(() => insideLibrary(relative, '/media/twitch')).toThrow(/outside the library/);
  });

  it('refuses a sibling folder sharing the prefix', () => {
    expect(() => insideLibrary('../twitch-other/x.mkv', '/media/twitch')).toThrow(/outside/);
  });
});
