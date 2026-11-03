import { describe, expect, it } from 'vitest';
import { changedNumber } from './setting-rows';

describe('changedNumber', () => {
  it('passes a real change', () => {
    expect(changedNumber('24', 20)).toBe(24);
    expect(changedNumber('0', 3)).toBe(0);
  });

  it('never turns a cleared field into 0', () => {
    expect(changedNumber('', 2)).toBeNull();
    expect(changedNumber('   ', 2)).toBeNull();
  });

  it('skips a value that did not change', () => {
    expect(changedNumber('20', 20)).toBeNull();
  });

  it('skips something that is not a number', () => {
    expect(changedNumber('abc', 20)).toBeNull();
  });
});
