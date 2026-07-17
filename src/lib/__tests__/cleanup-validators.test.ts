import { describe, expect, it } from 'vitest';
import { validateStallRulePayload, validateSlowRulePayload } from '@/app/api/cleanup/queue/_validators';
import { validateSeedingRulePayload } from '@/app/api/cleanup/download/seeding-rules/_validator';

const common = { name: 'Rule', maxStrikes: 3, privacyType: 'both', minCompletionPercentage: 0, maxCompletionPercentage: 100 };
const slow = { ...common, minSpeedKbps: 100 };
const seeding = { name: 'Seed', categories: ['sonarr'], maxRatio: 2, minSeedTimeHours: 0, maxSeedTimeHours: -1 };

describe('cleanup rule validators', () => {
  it.each([{}, { name: '' }, { name: '   ' }])('rejects a missing or blank stall name', (body) => {
    expect(validateStallRulePayload(body)).toMatchObject({ ok: false, error: 'name is required' });
  });

  it.each([0, 2, 'nope'])('rejects invalid stall maxStrikes: %s', (maxStrikes) => {
    expect(validateStallRulePayload({ ...common, maxStrikes })).toMatchObject({ ok: false, error: 'maxStrikes must be >= 3' });
  });

  it('accepts three strikes and applies common defaults and normalization', () => {
    const result = validateStallRulePayload({ ...common, priority: 'nope', minimumProgressBytes: 1048576.9, reSearchOverride: true });
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ maxStrikes: 3, enabled: true, priority: 0, minimumProgressBytes: 1048576, reSearchOverride: true }) });
  });

  it.each([
    [{ ...common, privacyType: 'secret' }, 'invalid privacyType'],
    [{ ...common, minCompletionPercentage: -1 }, 'minCompletionPercentage out of range'],
    [{ ...common, minCompletionPercentage: 101 }, 'minCompletionPercentage out of range'],
    [{ ...common, maxCompletionPercentage: 0 }, 'maxCompletionPercentage out of range (1-100)'],
    [{ ...common, maxCompletionPercentage: 101 }, 'maxCompletionPercentage out of range (1-100)'],
    [{ ...common, minCompletionPercentage: 50, maxCompletionPercentage: 40 }, 'maxCompletionPercentage must be greater than minCompletionPercentage'],
    [{ ...common, minCompletionPercentage: 50, maxCompletionPercentage: 50 }, 'maxCompletionPercentage must be greater than minCompletionPercentage'],
    [{ ...common, changeCategory: true, deletePrivate: true }, 'cannot enable both changeCategory and deletePrivate'],
  ])('rejects invalid common rule input', (body, error) => {
    expect(validateStallRulePayload(body)).toMatchObject({ ok: false, error });
  });

  it.each([null, undefined])('normalizes reSearchOverride %s to null', (reSearchOverride) => {
    expect(validateStallRulePayload({ ...common, reSearchOverride })).toEqual({ ok: true, value: expect.objectContaining({ reSearchOverride: null }) });
  });

  it.each([['', null], [-1, null]])('normalizes minimumProgressBytes %s to %s', (minimumProgressBytes, expected) => {
    expect(validateStallRulePayload({ ...common, minimumProgressBytes })).toEqual({ ok: true, value: expect.objectContaining({ minimumProgressBytes: expected }) });
  });

  it.each([
    [{ ...common }, 'either minSpeedKbps or maxTimeHours must be > 0'],
    [{ ...common, minSpeedKbps: 0, maxTimeHours: 0 }, 'either minSpeedKbps or maxTimeHours must be > 0'],
    [{ ...common, minSpeedKbps: -1 }, 'minSpeedKbps must be >= 0'],
    [{ ...common, maxTimeHours: -1 }, 'maxTimeHours must be >= 0'],
  ])('rejects invalid slow thresholds', (body, error) => {
    expect(validateSlowRulePayload(body)).toMatchObject({ ok: false, error });
  });

  it('accepts either slow threshold and normalizes numeric fields', () => {
    expect(validateSlowRulePayload({ ...common, minSpeedKbps: 100.7, ignoreAboveSizeBytes: '' })).toEqual({ ok: true, value: expect.objectContaining({ minSpeedKbps: 100, maxTimeHours: null, ignoreAboveSizeBytes: null }) });
    expect(validateSlowRulePayload({ ...common, maxTimeHours: 2 })).toEqual({ ok: true, value: expect.objectContaining({ minSpeedKbps: null, maxTimeHours: 2 }) });
  });

  it('applies common validation to slow rules', () => {
    expect(validateSlowRulePayload({ ...slow, privacyType: 'secret' })).toMatchObject({ ok: false, error: 'invalid privacyType' });
    expect(validateSlowRulePayload({ ...slow, changeCategory: true, deletePrivate: true })).toMatchObject({ ok: false });
  });

  it('accepts the full completion range for stall and slow rules', () => {
    expect(validateStallRulePayload({ ...common, minCompletionPercentage: 0, maxCompletionPercentage: 100 })).toMatchObject({ ok: true });
    expect(validateSlowRulePayload({ ...slow, minCompletionPercentage: 0, maxCompletionPercentage: 100 })).toMatchObject({ ok: true });
  });

  it.each([{ name: '' }, { name: '   ' }])('rejects blank seeding names', (body) => {
    expect(validateSeedingRulePayload({ ...seeding, ...body })).toMatchObject({ ok: false, error: 'name is required' });
  });

  it('rejects reserved priority and unconstrained rules', () => {
    expect(validateSeedingRulePayload({ ...seeding, priority: -1 })).toMatchObject({ ok: false, error: expect.stringContaining('reserved') });
    expect(validateSeedingRulePayload({ ...seeding, categories: [], trackerPatterns: [], tagsAny: [], tagsAll: [] })).toMatchObject({ ok: false, error: expect.stringContaining('at least one') });
  });

  it('trims filters and applies seeding defaults', () => {
    expect(validateSeedingRulePayload({ ...seeding, categories: ['  ', 'a'] })).toEqual({ ok: true, value: expect.objectContaining({ categories: ['a'], privacyType: 'both', deleteSourceFiles: true, requireImportedConfirmation: false }) });
  });

  it.each([
    [{ ...seeding, privacyType: 'secret' }, 'invalid privacyType'],
    [{ ...seeding, maxRatio: -2 }, 'maxRatio must be >= 0, or -1 to disable'],
    [{ ...seeding, minSeedTimeHours: -1 }, 'minSeedTimeHours must be >= 0'],
    [{ ...seeding, maxSeedTimeHours: -2 }, 'maxSeedTimeHours must be >= 0, or -1 to disable'],
    [{ ...seeding, minSeedTimeHours: 5, maxSeedTimeHours: 4 }, 'minSeedTimeHours cannot exceed maxSeedTimeHours'],
  ])('rejects invalid seeding input', (body, error) => {
    expect(validateSeedingRulePayload(body)).toMatchObject({ ok: false, error });
  });

  it('rejects permanently inert seeding thresholds', () => {
    expect(validateSeedingRulePayload({ ...seeding, maxRatio: -1, maxSeedTimeHours: -1 })).toMatchObject({ ok: false, error: expect.stringContaining('can never trigger') });
    expect(validateSeedingRulePayload({ ...seeding, maxRatio: -1, minSeedTimeHours: 5, maxSeedTimeHours: -1 })).toMatchObject({ ok: false, error: expect.stringContaining('can never trigger') });
  });

  it('accepts either enabled seeding threshold', () => {
    expect(validateSeedingRulePayload({ ...seeding, maxRatio: -1, maxSeedTimeHours: 5 })).toMatchObject({ ok: true });
    expect(validateSeedingRulePayload({ ...seeding, maxRatio: 1, maxSeedTimeHours: -1 })).toMatchObject({ ok: true });
  });
});
