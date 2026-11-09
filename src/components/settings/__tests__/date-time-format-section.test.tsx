// @vitest-environment jsdom
import type React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import { toast } from 'sonner';
import { DateTimeFormatSection } from '../date-time-format-section';
import { DateFormatInit } from '@/components/date-format-init';
import { getDateTimePrefs, setDateTimePrefs } from '@/lib/date-format';
import { hourLabel } from '@/lib/format';
import { formatDateValue } from '@/app/(app)/series/[id]/_components/format';

const fetchMock = vi.fn();

function renderSection() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><DateTimeFormatSection /></QueryClientProvider>);
}

beforeEach(() => {
  setDateTimePrefs({ timeFormat: 'auto', dateFormat: 'auto' });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('DateTimeFormatSection', () => {
  it('saves a choice and updates the preview at once', async () => {
    // The preview shows today, not a fixed date.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2027, 2, 4, 9, 15));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ timeFormat: '24h', dateFormat: 'iso' }), { status: 200 }));
    renderSection();
    const [timeSelect, dateSelect] = screen.getAllByRole('combobox');

    await userEvent.selectOptions(timeSelect, '24h');
    await userEvent.selectOptions(dateSelect, 'iso');

    expect(screen.getByTestId('date-time-preview').textContent).toBe('2027-03-04 20:26');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([
      { timeFormat: '24h' },
      { dateFormat: 'iso' },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/me/settings');
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    expect(getDateTimePrefs()).toEqual({ timeFormat: '24h', dateFormat: 'iso' });
  });

  it('puts the old choice back when saving fails', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    renderSection();
    await userEvent.selectOptions(screen.getAllByRole('combobox')[1], 'dmy');

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(getDateTimePrefs().dateFormat).toBe('auto');
    expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('auto');
  });
});

describe('DateFormatInit', () => {
  it('seeds the preference, and a repeated stale seed does not undo a later change', () => {
    const { rerender } = render(<DateFormatInit value={{ timeFormat: '12h', dateFormat: 'mdy' }} />);
    expect(getDateTimePrefs()).toEqual({ timeFormat: '12h', dateFormat: 'mdy' });

    setDateTimePrefs({ timeFormat: '24h', dateFormat: 'mdy' });
    rerender(<DateFormatInit value={{ timeFormat: '12h', dateFormat: 'mdy' }} />);
    expect(getDateTimePrefs().timeFormat).toBe('24h');
  });
});

describe('converted call sites follow the preference', () => {
  it('hour pickers and series dates', () => {
    setDateTimePrefs({ timeFormat: '24h', dateFormat: 'dmy' });
    expect(hourLabel(23)).toBe('23:00');
    expect(hourLabel(7)).toBe('07:00');
    expect(formatDateValue('2024-03-02')).toBe('2 Mar 2024');

    setDateTimePrefs({ timeFormat: '12h', dateFormat: 'iso' });
    expect(hourLabel(23)).toMatch(/^11:00\s?PM$/i);
    expect(formatDateValue('2024-03-02T18:30:00', true)).toMatch(/^2024-03-02 at 6:30\s?PM$/i);
  });
});
