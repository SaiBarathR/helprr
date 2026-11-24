// @vitest-environment jsdom

import { useState, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// vaul needs pointer capture, which jsdom lacks; the drawer shell is not under test.
vi.mock('@/components/ui/drawer', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Drawer: Pass, DrawerClose: Pass, DrawerContent: Pass, DrawerDescription: Pass, DrawerFooter: Pass, DrawerHeader: Pass, DrawerTitle: Pass };
});

import { TorrentDeleteDrawer, type DeleteDrawerState } from '../torrent-delete-drawer';

function Harness({ onDelete }: { onDelete: (state: DeleteDrawerState) => void }) {
  const [state, setState] = useState<DeleteDrawerState>({ open: true, hash: 'abc', name: 'Ubuntu ISO', deleteFiles: false });
  return <TorrentDeleteDrawer deleteDrawer={state} setDeleteDrawer={setState} handleDelete={() => onDelete(state)} deleting={false} />;
}

describe('TorrentDeleteDrawer', () => {
  it('uses the app checkbox to opt into deleting the files, with its warning', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);

    const box = screen.getByRole('checkbox', { name: 'Also delete downloaded files' });
    expect(box.getAttribute('data-slot')).toBe('checkbox');
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText(/permanently delete the downloaded files/)).toBeNull();

    await user.click(screen.getByText('Also delete downloaded files'));
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/permanently delete the downloaded files/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ hash: 'abc', deleteFiles: true }));

    await user.click(box);
    expect(box.getAttribute('aria-checked')).toBe('false');
  });
});
