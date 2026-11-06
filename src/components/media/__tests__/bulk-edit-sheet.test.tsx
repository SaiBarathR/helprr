// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  compact: false,
  useQualityProfiles: vi.fn(),
  useRootFolders: vi.fn(),
  useMetadataProfiles: vi.fn(),
}));

vi.mock('@/lib/hooks/use-compact-viewport', () => ({ useCompactViewport: () => mocks.compact }));
vi.mock('@/lib/hooks/use-reference-data', () => ({
  useQualityProfiles: mocks.useQualityProfiles,
  useRootFolders: mocks.useRootFolders,
  useMetadataProfiles: mocks.useMetadataProfiles,
}));

import { BulkActionBar } from '@/components/media/bulk-action-bar';
import type { BulkEditSheetOptions } from '@/components/media/bulk-edit-sheet';

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.compact = false;
  mocks.useQualityProfiles.mockReturnValue({ data: [{ id: 1, name: 'HD-1080p' }] });
  mocks.useRootFolders.mockReturnValue({ data: [{ id: 1, path: '/media/a' }, { id: 2, path: '/media/b' }] });
  mocks.useMetadataProfiles.mockReturnValue({ data: [{ id: 2, name: 'Standard' }] });
});

function renderBar(options: Partial<BulkEditSheetOptions> = {}, count = 3, itemNoun = 'series') {
  const bulkEdit: BulkEditSheetOptions = {
    service: 'sonarr',
    instanceId: 'sonarr-1',
    isAdmin: true,
    canChangePath: true,
    canOrganize: true,
    onApply: vi.fn().mockResolvedValue(true),
    onOrganize: vi.fn().mockResolvedValue(true),
    ...options,
  };
  render(
    <BulkActionBar
      count={count}
      allSelected={false}
      onToggleSelectAll={() => {}}
      onCancel={() => {}}
      onSearch={async () => {}}
      itemNoun={itemNoun}
      bulkEdit={bulkEdit}
    />
  );
  return bulkEdit;
}

async function pick(label: string, option: string) {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('bulk "More" sheet', () => {
  it('confirms a file move with the count and folder before applying it', async () => {
    const bulkEdit = renderBar();
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit 3 series' });
    for (const label of ['Quality Profile', 'Series Type', 'Monitor New Seasons', 'Season Folder', 'Root Folder']) {
      expect(within(dialog).getByLabelText(label)).toBeTruthy();
    }

    await pick('Root Folder', '/media/b');
    await userEvent.click(screen.getByLabelText('Move Files'));
    await userEvent.click(screen.getByRole('button', { name: 'Apply to 3 series' }));

    const confirm = await screen.findByRole('alertdialog', { name: 'Move files for 3 series?' });
    expect(confirm.textContent).toContain('move the files of 3 series into /media/b');
    expect(bulkEdit.onApply).not.toHaveBeenCalled();

    await userEvent.click(within(confirm).getByRole('button', { name: 'Move files' }));
    expect(bulkEdit.onApply).toHaveBeenCalledWith({ rootFolderPath: '/media/b', moveFiles: true });
  });

  it('applies settings fields without a confirmation when nothing moves', async () => {
    const bulkEdit = renderBar();
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await pick('Series Type', 'Anime');
    await pick('Season Folder', 'No season folders');
    await pick('Quality Profile', 'HD-1080p');
    await userEvent.click(screen.getByRole('button', { name: 'Apply to 3 series' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(bulkEdit.onApply).toHaveBeenCalledWith({ qualityProfileId: 1, seriesType: 'anime', seasonFolder: false });
  });

  it('shows a member only the root folder, and never fetches the admin-only profiles', async () => {
    const bulkEdit = renderBar({ service: 'radarr', isAdmin: false, canOrganize: false }, 2, 'movie');
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByLabelText('Quality Profile')).toBeNull();
    expect(screen.queryByLabelText('Minimum Availability')).toBeNull();
    expect(screen.queryByRole('button', { name: /Organize/ })).toBeNull();
    expect(mocks.useQualityProfiles).toHaveBeenCalledWith('radarr', 'sonarr-1', false);

    await pick('Root Folder', '/media/a');
    expect(screen.getByText(/Only the saved path changes/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Apply to 2 movies' }));
    expect(bulkEdit.onApply).toHaveBeenCalledWith({ rootFolderPath: '/media/a', moveFiles: false });
  });

  it('needs one instance for profile and folder pickers', async () => {
    renderBar({ service: 'lidarr', instanceId: null }, 4, 'artist');
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByText(/The selection spans instances/)).toBeTruthy();
    expect((screen.getByLabelText('Quality Profile') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Metadata Profile') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Root Folder') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Monitor New Albums') as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.useRootFolders).toHaveBeenCalledWith('lidarr', undefined, false);
    expect(mocks.useMetadataProfiles).toHaveBeenCalledWith(undefined, false);
  });

  it('confirms Organize before renaming files', async () => {
    const bulkEdit = renderBar({ service: 'radarr', isAdmin: false, canChangePath: false }, 2, 'movie');
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Organize files' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Organize 2 movies?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Organize' }));
    expect(bulkEdit.onOrganize).toHaveBeenCalledTimes(1);
  });

  it('closes after a full success, but stays open with its picks after a partial failure', async () => {
    const onApply = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderBar({ onApply });
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await pick('Series Type', 'Anime');
    await userEvent.click(screen.getByRole('button', { name: 'Apply to 3 series' }));
    expect(onApply).toHaveBeenCalledTimes(1);

    // Partial failure: still open, pick kept, so the user can retry the failed instances.
    const dialog = screen.getByRole('dialog', { name: 'Edit 3 series' });
    expect(within(dialog).getByLabelText('Series Type').textContent).toContain('Anime');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply to 3 series' }));
    expect(onApply).toHaveBeenNthCalledWith(2, { seriesType: 'anime' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit 3 series' })).toBeNull());
  });

  it('keeps the sheet open when Organize partly fails', async () => {
    const onOrganize = vi.fn().mockResolvedValue(false);
    renderBar({ onOrganize });
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(screen.getByRole('button', { name: 'Organize files' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Organize 3 series?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Organize' }));
    expect(onOrganize).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Edit 3 series' })).toBeTruthy();
  });

  it('hides More when the user can change none of it', () => {
    renderBar({ isAdmin: false, canChangePath: false, canOrganize: false });
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('opens as a bottom sheet on a phone', async () => {
    mocks.compact = true;
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit 3 series' });
    expect(sheet.getAttribute('data-slot')).toBe('drawer-content');
  });
});
