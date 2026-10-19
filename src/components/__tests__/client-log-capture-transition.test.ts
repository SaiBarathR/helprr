import { describe, expect, it } from 'vitest';
import { isSkippedViewTransition } from '../client-log-capture';

describe('skipped page transitions in the client log', () => {
  it('recognises only the browser\'s skipped-transition rejection', () => {
    expect(isSkippedViewTransition(new DOMException('Transition was skipped', 'AbortError'))).toBe(true);
    expect(isSkippedViewTransition(new DOMException('Transition was skipped. Navigation was cancelled.', 'AbortError'))).toBe(true);
    expect(isSkippedViewTransition(new DOMException('Old view transition aborted by new view transition.', 'AbortError'))).toBe(true);
    expect(isSkippedViewTransition(new DOMException('Skipped ViewTransition due to another transition starting', 'AbortError'))).toBe(true);
    expect(isSkippedViewTransition(new DOMException('Skipping view transition because skipTransition() was called.', 'AbortError'))).toBe(true);
    expect(isSkippedViewTransition(new DOMException('Skipped ViewTransition due to skipTransition() call', 'AbortError'))).toBe(true);
    expect(isSkippedViewTransition(new DOMException('Transition was skipped because', 'AbortError'))).toBe(false);
    expect(isSkippedViewTransition(new DOMException('The operation was aborted.', 'AbortError'))).toBe(false);
    expect(isSkippedViewTransition(new Error('Transition was skipped'))).toBe(false);
    expect(isSkippedViewTransition(null)).toBe(false);
    expect(isSkippedViewTransition('Transition was skipped')).toBe(false);
    expect(isSkippedViewTransition(undefined)).toBe(false);
  });
});
