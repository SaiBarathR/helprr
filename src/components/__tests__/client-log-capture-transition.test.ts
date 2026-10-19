import { describe, expect, it } from 'vitest';
import { isSkippedViewTransition } from '../client-log-capture';

describe('skipped page transitions in the client log', () => {
  it('recognises only the browser\'s skipped-transition rejection', () => {
    expect(isSkippedViewTransition(new DOMException('Transition was skipped', 'AbortError'))).toBe(true);
    expect(isSkippedViewTransition(new DOMException('The operation was aborted.', 'AbortError'))).toBe(false);
    expect(isSkippedViewTransition(new Error('Transition was skipped'))).toBe(false);
    expect(isSkippedViewTransition(null)).toBe(false);
    expect(isSkippedViewTransition('Transition was skipped')).toBe(false);
    expect(isSkippedViewTransition(undefined)).toBe(false);
  });
});
