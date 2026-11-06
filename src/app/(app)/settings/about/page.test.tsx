// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import AboutSettingsPage from './page';

describe('About page', () => {
  it('shows the license, source, privacy and the TMDB notice with its logo', () => {
    render(<AboutSettingsPage />);

    expect(screen.getByRole('heading', { name: 'About' })).toBeTruthy();
    expect(screen.getByText('GPL-3.0')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Source code/ }).getAttribute('href')).toBe('https://github.com/SaiBarathR/helprr');
    expect(screen.getByRole('link', { name: /Privacy/ }).getAttribute('href')).toBe('https://saibarathr.github.io/helprr/reference/privacy/');
    expect(screen.getByText(/This product uses the TMDB API but is not endorsed or certified by TMDB\./)).toBeTruthy();
    expect(screen.getByRole('img', { name: 'TMDB' }).getAttribute('src')).toContain('/images/tmdb-logo.svg');
    expect(screen.getByRole('link', { name: 'AniList' }).getAttribute('href')).toBe('https://anilist.co');
    expect(screen.getByRole('link', { name: 'Jellyfin' }).getAttribute('href')).toBe('https://jellyfin.org');
  });

  describe("What's new", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("loads the running release's notes, and tries again after a failed load", async () => {
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new TypeError('offline'))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          version: '1.14.0',
          omitted: 0,
          releases: [{ version: '1.14.0', date: '2026-11-06', body: '- Phone controls.' }],
        })));
      vi.stubGlobal('fetch', fetchMock);
      render(<AboutSettingsPage />);

      await userEvent.click(screen.getByRole('button', { name: /What's new/ }));
      expect(await screen.findByText(/Could not load the release notes/)).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith('/api/whats-new?current=1', expect.anything());

      await userEvent.click(screen.getByRole('button', { name: 'Done' }));
      await userEvent.click(screen.getByRole('button', { name: /What's new/ }));
      expect(await screen.findByText('Phone controls.')).toBeTruthy();
      expect(screen.getByRole('dialog', { name: "What's new in 1.14.0" })).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
