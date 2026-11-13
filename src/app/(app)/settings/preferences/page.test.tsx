// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ me: { role: 'member', capabilities: {} } as { role: string; capabilities: Record<string, boolean> } }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock('@/components/permission-provider', () => ({
  useMe: () => mocks.me,
  hasCapability: () => false,
}));
vi.mock('@/lib/hooks/use-app-settings', () => ({
  useAppSettings: () => ({ settings: { pollingIntervalSecs: 30, watchProviderRegion: 'IN', timeZone: 'Asia/Kolkata' }, loading: false, update: vi.fn() }),
}));
vi.mock('@/components/settings/date-time-format-section', () => ({ DateTimeFormatSection: () => <div>Date &amp; Time</div> }));
vi.mock('@/components/settings/personal-time-zone-row', () => ({ PersonalTimeZoneRow: () => null }));

import PreferencesPage from './page';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ regions: [] })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Preferences page', () => {
  it('shows a member only what they may save, not the global settings an admin owns', () => {
    mocks.me = { role: 'member', capabilities: {} };
    render(<PreferencesPage />);
    expect(screen.getByText('Date & Time')).toBeTruthy();
    for (const label of ['Server time zone', 'Polling', 'Activity refresh', 'Torrents refresh', 'Region']) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('shows an admin the global settings', () => {
    mocks.me = { role: 'admin', capabilities: {} };
    render(<PreferencesPage />);
    for (const label of ['Server time zone', 'Polling', 'Activity refresh', 'Torrents refresh', 'Region']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});
