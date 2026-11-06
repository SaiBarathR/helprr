import { describe, expect, it } from 'vitest';
import { migrateUiPrefs, useUIStore } from '@/lib/store';

describe('the Requests status filter', () => {
  it('starts unpicked, so the page chooses by role', () => {
    expect(useUIStore.getState().requestsFilter).toBeNull();
  });

  it('turns the old Pending default into unpicked once', () => {
    expect(migrateUiPrefs({ requestsFilter: 'pending' }, 51)).toMatchObject({ requestsFilter: null });
  });

  it('keeps any other pick, and a Pending picked after that', () => {
    expect(migrateUiPrefs({ requestsFilter: 'available' }, 51)).toMatchObject({ requestsFilter: 'available' });
    expect(migrateUiPrefs({ requestsFilter: 'pending' }, 52)).toMatchObject({ requestsFilter: 'pending' });
  });

  it('adds nothing a partial import never had', () => {
    expect(migrateUiPrefs({ torrentsView: 'table' }, 51)).not.toHaveProperty('requestsFilter');
  });
});
