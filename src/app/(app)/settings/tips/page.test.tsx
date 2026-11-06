// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import TipsSettingsPage from './page';

describe('Tips & gestures settings page', () => {
  it('lists the gestures, search shortcuts and Siri Shortcuts', () => {
    render(<TipsSettingsPage />);

    expect(screen.getByRole('heading', { name: 'Tips & gestures' })).toBeTruthy();
    for (const label of ['Press and hold', 'Swipe a row', 'Pull to refresh', 'Open search', 'Search one place']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('⌘K')).toBeTruthy();
    expect(screen.getByText('tm')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Siri Shortcuts/ }).getAttribute('href')).toBe('/settings/shortcuts');
  });
});
