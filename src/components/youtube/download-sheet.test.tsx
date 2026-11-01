// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreatorVideoItem } from '@/components/creators/types';
import { DEFAULT_YOUTUBE_OPTIONS, type DownloadOptions } from '@/lib/archive/jobs';
import mkbhd from '@/lib/youtube/fixtures/mkbhd-2-1.json';
import wan from '@/lib/youtube/fixtures/wan-1080.json';
import { summarizeFormats, type VideoFormats } from '@/lib/youtube/formats';
import { YoutubeDownloadSheet } from './download-sheet';

vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => false }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const video = { id: 'v1', title: 'A video', durationSeconds: 1745, creator: { displayName: 'MKBHD' } } as unknown as CreatorVideoItem;

const answers = {
  formats: null as VideoFormats | null,
  pending: false,
  defaults: DEFAULT_YOUTUBE_OPTIONS as DownloadOptions,
};
let posted: Array<Record<string, unknown>> = [];

function reply(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function mountSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <YoutubeDownloadSheet video={video} open onOpenChange={() => undefined} />
    </QueryClientProvider>,
  );
}

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent);
const activeTab = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('data-state') === 'active')?.textContent;
const rowValue = (label: string) => screen.getByText(label).parentElement?.lastElementChild?.textContent;

describe('YoutubeDownloadSheet', () => {
  beforeEach(() => {
    answers.formats = null;
    answers.pending = false;
    answers.defaults = DEFAULT_YOUTUBE_OPTIONS;
    posted = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/formats')) {
        if (init?.method === 'POST') return reply({ ok: true });
        return reply({ formats: answers.formats, pending: answers.pending });
      }
      if (url === '/api/youtube/jobs') {
        posted.push(JSON.parse(String(init?.body)));
        return reply({ ok: true });
      }
      return reply({ ...video, defaults: answers.defaults });
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows no quality, size or button to press until the real answer is in', async () => {
    answers.pending = true;
    mountSheet();
    expect((await screen.findByRole('status')).textContent).toContain('Checking what this video offers');
    expect(screen.queryAllByRole('tab')).toEqual([]);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Download' }).disabled).toBe(true);
  });

  it('offers 4K on a 2:1 video, and 4K means 4K', async () => {
    answers.formats = summarizeFormats(mkbhd);
    mountSheet();
    await screen.findByRole('tab', { name: '4K' });
    expect(tabNames()).toEqual(['Best', '4K', '1440p', '1080p', '720p', '480p']);

    await userEvent.click(screen.getByRole('tab', { name: '4K' }));
    expect(rowValue('Resolution')).toBe('4K (3840×1920)');
    expect(rowValue('Size')).toBe('786.1 MB');
    expect(screen.getByRole('radio', { checked: true }).textContent).toContain('VP9');
    screen.getByText(/YouTube has no H\.264 copy at 4K, so this uses VP9/);
  });

  it('lists only the codecs that exist at that quality, each with its real size', async () => {
    answers.formats = summarizeFormats(mkbhd);
    mountSheet();
    await screen.findByRole('tab', { name: '4K' });
    expect(screen.getAllByRole('radio').map((row) => row.textContent)).toEqual(['H.264Plays everywhere113.8 MB', 'VP995.6 MB', 'AV173.7 MB']);
    await userEvent.click(screen.getByRole('tab', { name: '4K' }));
    expect(screen.getAllByRole('radio').map((row) => row.textContent)).toEqual(['VP9786.1 MB', 'AV1336.4 MB']);
  });

  it('shows only what a 1080p video has', async () => {
    answers.formats = summarizeFormats(wan);
    mountSheet();
    await screen.findByRole('tab', { name: '1080p' });
    expect(tabNames().slice(0, 2)).toEqual(['Best', '1080p']);
  });

  it('starts from the rules, and lands on the nearest when the video stops lower', async () => {
    answers.formats = summarizeFormats(wan);
    answers.defaults = { ...DEFAULT_YOUTUBE_OPTIONS, quality: '2160', codec: 'av1', keepForever: true };
    mountSheet();
    await screen.findByRole('tab', { name: '1080p' });
    expect(activeTab()).toBe('1080p');
    expect(screen.getByRole('radio', { checked: true }).textContent).toContain('AV1');
  });

  it('sends what was chosen', async () => {
    answers.formats = summarizeFormats(mkbhd);
    mountSheet();
    await userEvent.click(await screen.findByRole('tab', { name: '4K' }));
    await userEvent.click(screen.getByRole('radio', { name: /AV1/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].options).toMatchObject({ quality: '2160', codec: 'av1', hdr: false, formatId: '401', sponsorblock: 'mark' });
  });

  it('says so, with no made-up size, when the worker cannot answer', async () => {
    answers.pending = true;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mountSheet();
    await screen.findByRole('status');
    await act(() => vi.advanceTimersByTimeAsync(21_000));
    screen.getByText(/could not check this video/);
    expect(rowValue('Size')).toBe('Not known');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Download' }).disabled).toBe(false);
  });

  it('never shows the failure while its own request is still on the way', async () => {
    let finish = (_response: Response) => undefined as void;
    const answer = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, init) => (
      init?.method === 'POST' ? new Promise<Response>((resolve) => { finish = resolve; }) : answer(url, init)
    ));
    mountSheet();
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    expect(screen.queryByText(/could not check/)).toBeNull();
    screen.getByRole('status');
    answers.formats = summarizeFormats(mkbhd);
    finish(reply({ ok: true }));
    await screen.findByRole('tab', { name: '4K' });
    expect(screen.queryByText(/could not check/)).toBeNull();
  });

  it('says so when the lookup ends with nothing', async () => {
    mountSheet();
    await screen.findByText(/could not check this video/);
  });
});
