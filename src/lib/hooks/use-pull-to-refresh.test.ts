import { describe, expect, it } from 'vitest';
import { isPullToRefreshAtTop } from './use-pull-to-refresh';

describe('isPullToRefreshAtTop', () => {
  it('allows refresh when the document and nested scroll target are both at the top', () => {
    expect(isPullToRefreshAtTop(0, 0)).toBe(true);
    expect(isPullToRefreshAtTop(undefined, 0)).toBe(true);
  });

  it('blocks refresh when the nested target has scrolled', () => {
    expect(isPullToRefreshAtTop(24, 0)).toBe(false);
  });

  it('blocks refresh when the document has scrolled but the nested target has not', () => {
    expect(isPullToRefreshAtTop(0, 320)).toBe(false);
  });

  it('treats a negative rubber-band offset as the top boundary', () => {
    expect(isPullToRefreshAtTop(-4, -2)).toBe(true);
  });
});
