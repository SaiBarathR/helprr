// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppError from '@/app/(app)/error';
import GlobalError from '@/app/global-error';
import { SegmentError } from './segment-error';

vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const boundaries = [
  ['app', (error: Error, reset: () => void) => <AppError error={error} reset={reset} />],
  ['segment', (error: Error, reset: () => void) => (
    <SegmentError error={error} reset={reset} backHref="/movies" backLabel="Back to Movies" />
  )],
  ['global', (error: Error, reset: () => void) => <GlobalError error={error} reset={reset} />],
] as const;

function chunkError() {
  const error = new Error('Loading chunk 123 failed.');
  error.name = 'ChunkLoadError';
  return error;
}

describe.each(boundaries)('%s error boundary', (_name, renderBoundary) => {
  const reload = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    reload.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('location', { pathname: '/movies', reload });
    vi.stubGlobal('caches', { delete: vi.fn().mockResolvedValue(true) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reloads once on its own after a stale-deploy chunk error', async () => {
    const reset = vi.fn();
    const { unmount } = render(renderBoundary(chunkError(), reset));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    unmount();

    // The reloaded page hits the same missing chunk: no second automatic reload.
    render(renderBoundary(chunkError(), reset));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reload).toHaveBeenCalledOnce();

    // Try again reloads instead of re-importing the missing chunk.
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    expect(reset).not.toHaveBeenCalled();
  });

  it('keeps Try again as reset() for other errors', async () => {
    const reset = vi.fn();
    render(renderBoundary(new Error('boom'), reset));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps Try again as reset() for a chunk error while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const reset = vi.fn();
    render(renderBoundary(chunkError(), reset));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });
});
