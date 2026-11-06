import { describe, expect, it } from 'vitest';
import { setupProgress, type SetupChecklistState } from '@/lib/setup-checklist-steps';

const none: SetupChecklistState['done'] = { service: false, people: false, push: false, install: false, backup: false };

describe('setupProgress', () => {
  it('counts required steps, and the optional one apart', () => {
    expect(setupProgress(none)).toEqual({ done: 0, total: 4, optionalDone: 0, complete: false });
    expect(setupProgress({ ...none, service: true, people: true })).toEqual({ done: 1, total: 4, optionalDone: 1, complete: false });
    expect(setupProgress({ ...none, service: true, push: true, install: true, backup: true })).toEqual({
      done: 4,
      total: 4,
      optionalDone: 0,
      complete: true,
    });
  });
});
