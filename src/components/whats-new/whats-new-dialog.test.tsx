// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WhatsNewOnUpdate } from '@/components/whats-new/whats-new-dialog';
import type { WhatsNew } from '@/lib/whats-new';

function mockFetch(notes: WhatsNew) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    new Response(JSON.stringify(init?.method === 'POST' ? { ok: true } : notes), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('WhatsNewOnUpdate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens with the notes after an update, and marks them seen when closed', async () => {
    const fetchMock = mockFetch({
      version: '1.14.0',
      omitted: 0,
      releases: [
        { version: '1.14.0', date: '2026-11-06', body: '### Added\n\n- **Phone controls** in the `player`.' },
        { version: '1.13.1', date: '2026-11-06', body: '- A fix.' },
      ],
    });
    render(<WhatsNewOnUpdate />);

    expect(await screen.findByRole('dialog', { name: "What's new in 1.14.0" })).toBeTruthy();
    expect(screen.getByText('Phone controls').tagName).toBe('STRONG');
    expect(screen.getByText('player').tagName).toBe('CODE');
    expect(screen.getByText('A fix.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Full changelog/ }).getAttribute('href')).toContain('CHANGELOG.md');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/whats-new',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ version: '1.14.0' }) }),
    );
  });

  it('stays closed when there is nothing new', async () => {
    const fetchMock = mockFetch({ version: '1.14.0', releases: [], omitted: 0 });
    render(<WhatsNewOnUpdate />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/whats-new', expect.objectContaining({ method: 'POST' }));
  });
});
