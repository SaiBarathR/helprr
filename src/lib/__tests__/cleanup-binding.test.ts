import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CleanupCandidateBinding, CleanupExecutionBinding } from '@/lib/cleanup/types';

vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnection: { findMany: vi.fn() },
  },
}));

import {
  assertExecutionBinding,
  buildExecutionBinding,
  candidateFingerprint,
  StaleCleanupPreviewError,
} from '@/lib/cleanup/binding';

const first: CleanupCandidateBinding = {
  cleaner: 'download',
  hash: 'aaa',
  ruleId: 'rule-1',
  removalKind: 'seeding',
  deleteSourceFiles: false,
};

const second: CleanupCandidateBinding = {
  cleaner: 'download',
  hash: 'bbb',
  ruleId: 'rule-2',
  removalKind: 'imported',
  deleteSourceFiles: true,
};

describe('cleanup execution bindings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses a stable candidate snapshot independent of upstream ordering', () => {
    expect(candidateFingerprint([first, second])).toBe(candidateFingerprint([second, first]));
    expect(buildExecutionBinding('download', 'config', 'scope', [second, first]).candidates)
      .toEqual([first, second]);
  });

  it.each([
    ['cleaner', { cleaner: 'queue' }],
    ['configuration', { configFingerprint: 'changed' }],
    ['service scope', { scopeFingerprint: 'changed' }],
    ['candidate drift', { candidatesFingerprint: 'changed' }],
  ] as const)('rejects %s mismatches before execution', (_label, changed) => {
    const expected = buildExecutionBinding('download', 'config', 'scope', [first]);
    const current: CleanupExecutionBinding = { ...expected, ...changed } as CleanupExecutionBinding;
    expect(() => assertExecutionBinding(expected, current)).toThrow(StaleCleanupPreviewError);
  });
});
