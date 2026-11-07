// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseBackupSection } from './database-backup-section';

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

function show(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DatabaseBackupSection />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DatabaseBackupSection', () => {
  it('shows how long ago backup.sh last backed up the database', async () => {
    const fetchMock = show(new Response(JSON.stringify({ lastBackupAt: daysAgo(3) })));
    const value = await screen.findByText('3 days ago');
    expect(value.className).not.toContain('amber');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/database-backup', expect.anything());
    expect(screen.getByRole('link', { name: /How to back up and restore/ }).getAttribute('href')).toBe(
      'https://saibarathr.github.io/helprr/maintain/backup/',
    );
  });

  it('shows an old backup in amber', async () => {
    show(new Response(JSON.stringify({ lastBackupAt: daysAgo(12) })));
    expect((await screen.findByText(/12 days ago/)).className).toContain('amber');
  });

  it('says in amber when none was recorded', async () => {
    show(new Response(JSON.stringify({ lastBackupAt: null })));
    expect((await screen.findByText('None recorded')).className).toContain('amber');
  });

  it('says it cannot tell when the read fails', async () => {
    show(new Response('{}', { status: 500 }));
    expect((await screen.findByText('Unavailable')).className).not.toContain('amber');
  });
});
