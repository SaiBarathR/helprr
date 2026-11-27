// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// One query object per width is cached by useIsMobile, so read the width live.
const viewport = vi.hoisted(() => ({ phone: false }));
const createTag = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-reference-data', () => ({
  useTags: () => ({ data: [{ id: 1, label: 'anime' }, { id: 2, label: '4k' }] }),
  useCreateTag: () => ({ isPending: false, mutateAsync: createTag }),
}));

import { TagSelector } from '../tag-selector';

// jsdom has no pointer capture, which the drawer asks for on a press inside it.
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

beforeEach(() => {
  createTag.mockReset();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query === '(max-width: 767px)' && viewport.phone; },
    addEventListener() {},
    removeEventListener() {},
  }));
});

function Tags() {
  const [value, setValue] = useState<number[]>([]);
  return <TagSelector service="radarr" value={value} onChange={setValue} />;
}

describe('TagSelector', () => {
  it('is a bottom sheet below md, its search not focused, where a new tag can be created', async () => {
    viewport.phone = true;
    createTag.mockResolvedValue({ id: 3, label: 'kids' });
    render(<Tags />);
    await userEvent.click(screen.getByRole('button', { name: 'Add tags' }));
    const sheet = await screen.findByRole('dialog', { name: 'Tags' });
    expect(sheet.getAttribute('data-vaul-drawer-direction')).toBe('bottom');
    // A focused field would open the phone keyboard as the sheet opens.
    const search = within(sheet).getByPlaceholderText('Search or create a tag…');
    expect(document.activeElement).not.toBe(search);

    await userEvent.click(within(sheet).getByRole('button', { name: /anime/ }));
    await userEvent.type(search, 'kids');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create “kids”' }));
    expect(createTag).toHaveBeenCalledWith('kids');
    expect(within(sheet).getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('is a popover from md up, its search focused at once', async () => {
    viewport.phone = false;
    render(<Tags />);
    await userEvent.click(screen.getByRole('button', { name: 'Add tags' }));
    const search = await screen.findByPlaceholderText('Search or create a tag…');
    expect(search.closest('[data-slot="popover-content"]')).not.toBeNull();
    expect(document.activeElement).toBe(search);
  });
});
