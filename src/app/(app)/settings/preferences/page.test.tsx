// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  me: { role: 'member', capabilities: {} } as { role: string; capabilities: Record<string, boolean> },
  update: vi.fn(async () => null),
}));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock('@/components/permission-provider', () => ({
  useMe: () => mocks.me,
  hasCapability: (me: typeof mocks.me, cap: string) => me.capabilities[cap] === true,
}));
vi.mock('@/lib/hooks/use-app-settings', () => ({
  useAppSettings: () => ({ settings: { pollingIntervalSecs: 30, watchProviderRegion: 'IN', timeZone: 'Asia/Kolkata' }, loading: false, update: mocks.update }),
}));
vi.mock('@/components/settings/date-time-format-section', () => ({ DateTimeFormatSection: () => <div>Date &amp; Time</div> }));
vi.mock('@/components/settings/personal-time-zone-row', () => ({ PersonalTimeZoneRow: () => null }));

import PreferencesPage from './page';

beforeEach(() => {
  mocks.update.mockClear();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ regions: [] })));
  // Radix's popover and cmdk's list need these, which jsdom lacks.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
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
    for (const label of ['Server time zone', 'Polling', 'Activity refresh', 'Torrents refresh', 'Region', 'Dashboard widget refresh']) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows an admin the global settings', () => {
    mocks.me = { role: 'admin', capabilities: { 'settings.dashboardRefresh': true } };
    render(<PreferencesPage />);
    for (const label of ['Server time zone', 'Polling', 'Activity refresh', 'Torrents refresh', 'Region', 'Dashboard widget refresh']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('picks the region from a searchable list with the current one first', async () => {
    mocks.me = { role: 'admin', capabilities: {} };
    const user = userEvent.setup();
    render(<PreferencesPage />);

    await user.click(screen.getByRole('button', { name: 'Region' }));
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')[0].textContent).toContain('India');

    await user.type(screen.getByPlaceholderText('Search regions'), 'germ');
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Germany/ }));
    expect(mocks.update).toHaveBeenCalledWith({ watchProviderRegion: 'DE' }, expect.anything());
  });
});
