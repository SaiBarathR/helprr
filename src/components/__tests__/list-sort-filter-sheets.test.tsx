// @vitest-environment jsdom

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstanceFilter } from '@/components/instance-filter';
import { FieldToggles } from '@/components/media/field-toggles';
import { RequestsSortMenu } from '@/components/seerr/requests-sort-menu';
import { ResponsiveMenu, ResponsiveMenuActionItem } from '@/components/ui/responsive-menu';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DiscoverToolbar } from '@/app/(app)/discover/_components/discover-toolbar';

vi.mock('@/components/media/search-bar', () => ({ SearchBar: () => null }));

// The list pages' sort, filter and view menus share one pattern: a bottom
// sheet on phones and a dropdown from md up.
const viewport = vi.hoisted(() => ({ phone: true }));

HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query === '(max-width: 767px)' && viewport.phone; },
    addEventListener() {},
    removeEventListener() {},
  }));
});

const INSTANCES = [{ id: 'a', label: 'Sonarr' }, { id: 'b', label: 'Sonarr 4K' }];

describe('list sort, filter and view menus on a phone', () => {
  beforeEach(() => { viewport.phone = true; });

  it('opens the instance filter as a sheet that stays open while picking', async () => {
    const onChange = vi.fn();
    render(<InstanceFilter instances={INSTANCES} value="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Instance: All instances' }));
    const sheet = await screen.findByRole('dialog', { name: 'Instance' });
    expect(within(sheet).getByRole('button', { name: 'All instances' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Sonarr 4K' }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('dialog', { name: 'Instance' })).toBeTruthy();
  });

  it('opens the view options as a sheet with poster size and fields', async () => {
    const onPosterSizeChange = vi.fn();
    const onChange = vi.fn();
    render(
      <FieldToggles
        available={[{ value: 'year', label: 'Year' }]}
        selected={[]}
        onChange={onChange}
        posterSize="medium"
        onPosterSizeChange={onPosterSizeChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Toggle fields' }));
    const sheet = await screen.findByRole('dialog', { name: 'View options' });
    expect(within(sheet).getByRole('button', { name: 'Medium' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Large' }));
    expect(onPosterSizeChange).toHaveBeenCalledWith('large');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Year' }));
    expect(onChange).toHaveBeenCalledWith(['year']);
  });

  it('opens the requests sort as a sheet', async () => {
    const onSortChange = vi.fn();
    render(
      <TooltipProvider>
        <RequestsSortMenu sort="added" onSortChange={onSortChange} sortDirection="desc" onSortDirectionChange={vi.fn()} />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Sort:/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Sort by' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Last Modified' }));
    expect(onSortChange).toHaveBeenCalledWith('modified');
  });

  it('closes the Discover content type sheet on a pick, since the pick opens its results', async () => {
    const handleSelectContentType = vi.fn();
    render(
      <DiscoverToolbar
        searchParamsKey="" query="" handleQueryChange={vi.fn()} discoverContentType="all"
        handleSelectContentType={handleSelectContentType} handleOpenFilters={vi.fn()} activeAdvancedFilterCount={0}
        discoverSort="trending" handleSelectSort={vi.fn()} rateLimitInfo={null} rateLimitCountdown={null}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Content type' }));
    const sheet = await screen.findByRole('dialog', { name: 'Content type' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Movies' }));
    expect(handleSelectContentType).toHaveBeenCalledWith('movie');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Content type' })).toBeNull());
  });

  it('runs a one-off action row inside the sheet', async () => {
    const onSelect = vi.fn();
    render(
      <ResponsiveMenu title="Filter" trigger={<button type="button">Filter</button>}>
        <ResponsiveMenuActionItem onSelect={onSelect}>Reset filters</ResponsiveMenuActionItem>
      </ResponsiveMenu>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filter' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Reset filters' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe('list sort, filter and view menus from md up', () => {
  beforeEach(() => { viewport.phone = false; });

  it('keeps the instance filter a titled dropdown', async () => {
    render(<InstanceFilter instances={INSTANCES} value="b" onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Instance: Sonarr 4K' }));
    const menu = await screen.findByRole('menu');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(menu).getByText('Instance')).toBeTruthy();
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Sonarr 4K' }).getAttribute('aria-checked')).toBe('true');
  });

  it('runs a one-off action as a menu item', async () => {
    const onSelect = vi.fn();
    render(
      <ResponsiveMenu title="Filter" trigger={<button type="button">Filter</button>}>
        <ResponsiveMenuActionItem onSelect={onSelect}>Reset filters</ResponsiveMenuActionItem>
      </ResponsiveMenu>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Reset filters' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
