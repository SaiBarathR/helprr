import { describe, expect, it } from 'vitest';
import { torrentsEmptyMessage } from './empty-message';

describe('torrentsEmptyMessage', () => {
  it('tells an empty client apart from a filtered-out list', () => {
    expect(torrentsEmptyMessage(false, false)).toBe('No torrents yet.');
    expect(torrentsEmptyMessage(true, false)).toBe('No torrents match your search.');
    expect(torrentsEmptyMessage(false, true)).toBe('No torrents match the active filters.');
    expect(torrentsEmptyMessage(true, true)).toBe('No torrents match your search and filters.');
  });
});
