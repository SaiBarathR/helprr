import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncedCommit } from '@/lib/hooks/use-debounced-commit';

describe('createDebouncedCommit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits the latest value once after the delay', () => {
    const commit = vi.fn();
    const d = createDebouncedCommit<string>(commit, 600);
    d.schedule('a');
    d.schedule('ab');
    d.schedule('abc');
    vi.advanceTimersByTime(599);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('abc', 'timer');
  });

  it('flushes a pending value immediately instead of dropping it', () => {
    const commit = vi.fn();
    const d = createDebouncedCommit<string>(commit, 600);
    d.schedule('abc');
    d.flush();
    expect(commit).toHaveBeenCalledWith('abc', 'flush');
    // Timer must not fire a second commit afterwards.
    vi.advanceTimersByTime(1000);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('commits pending edits on unmount (the drop-on-navigate defect)', () => {
    const commit = vi.fn();
    const d = createDebouncedCommit<string>(commit, 600);
    d.schedule('Europe/Berlin');
    d.unmount();
    expect(commit).toHaveBeenCalledWith('Europe/Berlin', 'unmount');
  });

  it('flush and unmount are no-ops with nothing pending', () => {
    const commit = vi.fn();
    const d = createDebouncedCommit<string>(commit, 600);
    d.flush();
    d.unmount();
    vi.advanceTimersByTime(1000);
    expect(commit).not.toHaveBeenCalled();
  });

  it('cancel discards the pending value', () => {
    const commit = vi.fn();
    const d = createDebouncedCommit<string>(commit, 600);
    d.schedule('abc');
    d.cancel();
    vi.advanceTimersByTime(1000);
    d.unmount();
    expect(commit).not.toHaveBeenCalled();
  });

  it('keeps a value pending when the commit says not now, and runs it again once the timer can fire', () => {
    const commit = vi.fn((_value: string, reason: string) => (reason === 'pagehide' ? false : undefined));
    const d = createDebouncedCommit<string>(commit, 600);
    d.schedule('5000');
    d.pagehide();
    expect(commit).toHaveBeenLastCalledWith('5000', 'pagehide');
    vi.advanceTimersByTime(600);
    expect(commit).toHaveBeenLastCalledWith('5000', 'timer');
    expect(commit).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(600);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('a new schedule after a commit starts a fresh cycle', () => {
    const commit = vi.fn();
    const d = createDebouncedCommit<string>(commit, 600);
    d.schedule('a');
    vi.advanceTimersByTime(600);
    d.schedule('b');
    vi.advanceTimersByTime(600);
    expect(commit).toHaveBeenNthCalledWith(1, 'a', 'timer');
    expect(commit).toHaveBeenNthCalledWith(2, 'b', 'timer');
  });
});
