// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveFilterBar, FilterDot, filterButtonLabel, searchFilter } from './active-filter-bar';

let root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); });

const button = (name: string) =>
  [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name);

describe('ActiveFilterBar', () => {
  it('renders nothing when no filter is active', async () => {
    await act(async () => root.render(<ActiveFilterBar filters={[]} onClearAll={() => {}} />));
    expect(document.getElementById('root')!.innerHTML).toBe('');
  });

  it('names each active filter and removes it on its own', async () => {
    const removeSonarr = vi.fn();
    await act(async () => root.render(
      <ActiveFilterBar filters={[{ id: 'sonarr', label: 'Sonarr', onRemove: removeSonarr }]} onClearAll={() => {}} />,
    ));
    expect(document.querySelector('[aria-label="Active filters"]')?.textContent).toContain('Sonarr');
    // One filter: its own remove button is enough, so there is no "Clear all".
    expect(button('Clear all')).toBeUndefined();
    await act(async () => button('Remove Sonarr filter')!.click());
    expect(removeSonarr).toHaveBeenCalledOnce();
  });

  it('offers Clear all once more than one filter is active', async () => {
    const clearAll = vi.fn();
    await act(async () => root.render(
      <ActiveFilterBar
        filters={[
          { id: 'sonarr', label: 'Sonarr', onRemove: () => {} },
          { id: 'instance', label: 'main (Sonarr)', onRemove: () => {} },
        ]}
        onClearAll={clearAll}
      />,
    ));
    await act(async () => button('Clear all')!.click());
    expect(clearAll).toHaveBeenCalledOnce();
  });

  it('gives each remove button a 44px hit area', async () => {
    await act(async () => root.render(
      <ActiveFilterBar filters={[{ id: 'sonarr', label: 'Sonarr', onRemove: () => {} }]} onClearAll={() => {}} />,
    ));
    expect(button('Remove Sonarr filter')!.className).toContain('touch-target');
  });
});

describe('searchFilter', () => {
  it('names a search as a filter and clears it', () => {
    const clear = vi.fn();
    const [chip] = searchFilter('  dune ', clear);
    expect(chip.label).toBe('Search: "dune"');
    chip.onRemove();
    expect(clear).toHaveBeenCalledOnce();
  });

  it('adds nothing for an empty search', () => {
    expect(searchFilter('   ', () => {})).toEqual([]);
  });
});

describe('filter trigger', () => {
  it('says when filters are active', () => {
    expect(filterButtonLabel('Filter', true)).toBe('Filter (filters active)');
    expect(filterButtonLabel('Filter', false)).toBe('Filter');
  });

  it('shows the dot only while filters are active', async () => {
    await act(async () => root.render(<FilterDot active={false} />));
    expect(document.getElementById('root')!.innerHTML).toBe('');
    await act(async () => root.render(<FilterDot active />));
    expect(document.querySelector('span[aria-hidden]')).not.toBeNull();
  });
});
