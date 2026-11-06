// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MePayload } from '@/components/permission-provider';
import { MEMBER_TEMPLATE } from '@/lib/permissions';

const mocks = vi.hoisted(() => ({ me: null as MePayload | null }));

vi.mock('@/components/permission-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/permission-provider')>()),
  useMe: () => mocks.me,
}));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import SettingsIndexPage from './page';

describe('Settings index', () => {
  it('shows the About row to a member with the default member template', () => {
    mocks.me = { role: 'member', template: 'member', capabilities: MEMBER_TEMPLATE } as MePayload;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><SettingsIndexPage /></QueryClientProvider>);

    expect(screen.getByRole('link', { name: /About/ }).getAttribute('href')).toBe('/settings/about');
    expect(screen.queryByRole('link', { name: /Instances/ })).toBeNull();
  });
});
