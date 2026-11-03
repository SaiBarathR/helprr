// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClampedText } from './clamped-text';

let measure: () => void = () => undefined;

function showText(scrollHeight: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60);
  render(<ClampedText text="Some text" />);
  act(() => measure());
}

describe('ClampedText', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
        measure = callback;
      }
      observe() {}
      disconnect() {}
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('offers Read more only when the clamp hides text', () => {
    showText(60);
    expect(screen.queryByRole('button', { name: 'Read more' })).toBeNull();
  });

  it('expands text the clamp hides, and collapses it again', async () => {
    showText(120);
    await userEvent.click(screen.getByRole('button', { name: 'Read more' }));
    expect(screen.getByText('Some text').className).not.toContain('line-clamp-3');
    await userEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.getByText('Some text').className).toContain('line-clamp-3');
  });
});
