import { describe, expect, it } from 'vitest';
import { repeatLabel } from '@/components/jellyfin-streaming/playback-provider';

describe('repeatLabel', () => {
  it('names the current repeat mode', () => {
    expect(repeatLabel('RepeatNone')).toBe('Repeat: off');
    expect(repeatLabel('RepeatAll')).toBe('Repeat: all');
    expect(repeatLabel('RepeatOne')).toBe('Repeat: one');
  });
});
