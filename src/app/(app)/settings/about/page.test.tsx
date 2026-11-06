// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
});
