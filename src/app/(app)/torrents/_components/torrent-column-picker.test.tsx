// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// The picker's menu as a plain list of its items.
vi.mock('@/components/ui/responsive-menu', () => ({
  ResponsiveMenu: ({ trigger, children }: { trigger: React.ReactNode; children: React.ReactNode }) => <div>{trigger}<div role="menu">{children}</div></div>,
  ResponsiveMenuCheckboxItem: ({ children, checked, onCheckedChange }: { children: React.ReactNode; checked: boolean; onCheckedChange: () => void }) => (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} onClick={onCheckedChange}>{children}</button>
  ),
  ResponsiveMenuActionItem: ({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) => (
    <button type="button" role="menuitem" onClick={onSelect}>{children}</button>
  ),
  ResponsiveMenuSeparator: () => <hr />,
}));

import { DEFAULT_TORRENTS_TABLE_COLUMNS, TORRENTS_TABLE_COLUMNS, useUIStore } from '@/lib/store';
import { TorrentColumnPicker } from './torrent-column-picker';
import { TorrentTagChips } from './torrent-row';

describe('torrent table column picker', () => {
  it('starts with the columns the table had before the picker, and offers every other one', () => {
    expect(useUIStore.getInitialState().torrentsTableColumns).toEqual([
      'state', 'progress', 'size', 'dlspeed', 'upspeed', 'eta', 'num_seeds', 'num_leechs', 'ratio',
    ]);
    render(<TorrentColumnPicker columns={DEFAULT_TORRENTS_TABLE_COLUMNS} onChange={vi.fn()} />);
    const items = screen.getAllByRole('menuitemcheckbox');
    expect(items).toHaveLength(TORRENTS_TABLE_COLUMNS.length);
    expect(items.filter((item) => item.getAttribute('aria-checked') === 'true').map((item) => item.textContent)).toEqual([
      'Status', 'Progress', 'Size', 'Download speed', 'Upload speed', 'ETA', 'Seeds', 'Peers', 'Ratio',
    ]);
    // Name always shows, so it is not offered.
    expect(screen.queryByText('Name')).toBeNull();
  });

  it('shows a column in table order and hides one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TorrentColumnPicker columns={['ratio', 'state']} onChange={onChange} />);
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Tags' }));
    expect(onChange).toHaveBeenLastCalledWith(['state', 'ratio', 'tags']);
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Status' }));
    expect(onChange).toHaveBeenLastCalledWith(['ratio']);
    await user.click(screen.getByRole('menuitem', { name: 'Default columns' }));
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_TORRENTS_TABLE_COLUMNS);
  });
});

describe('torrent tag chips', () => {
  it('shows the first tags and counts the rest, naming every tag for screen readers', () => {
    render(<TorrentTagChips tags={['4k', 'anime', 'keep', 'x']} max={2} />);
    const group = screen.getByLabelText('Tags: 4k, anime, keep, x');
    expect(group.textContent).toBe('4kanime+2');
    expect(group.getAttribute('title')).toBe('4k, anime, keep, x');
  });

  it('shows no count when every tag fits', () => {
    render(<TorrentTagChips tags={['4k']} max={2} />);
    expect(screen.getByLabelText('Tags: 4k').textContent).toBe('4k');
  });
});
