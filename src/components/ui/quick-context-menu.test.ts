import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  countEnabledContextActions,
  getTriggerHref,
  normalizeContextActionGroups,
  resolveOpenInNewTabTarget,
  resolveOpenInNewTabUrl,
  type ContextAction,
} from './quick-context-menu';

const openAction: ContextAction = { id: 'open', label: 'Open', href: '/example' };
const deleteAction: ContextAction = { id: 'delete', label: 'Delete', onSelect: () => {} };

describe('normalizeContextActionGroups', () => {
  it('wraps the flat action form in one group', () => {
    expect(normalizeContextActionGroups(undefined, [openAction, deleteAction])).toEqual([
      { id: 'actions', actions: [openAction, deleteAction] },
    ]);
  });

  it('drops empty groups without reordering actions', () => {
    expect(normalizeContextActionGroups([
      { id: 'primary', actions: [openAction] },
      { id: 'empty', actions: [] },
      { id: 'danger', actions: [deleteAction] },
    ])).toEqual([
      { id: 'primary', actions: [openAction] },
      { id: 'danger', actions: [deleteAction] },
    ]);
  });
});

describe('countEnabledContextActions', () => {
  it('does not count disabled or pending actions toward the two-action threshold', () => {
    expect(countEnabledContextActions([{
      actions: [
        openAction,
        { ...deleteAction, disabled: true },
        { id: 'loading', label: 'Loading', pending: true },
      ],
    }])).toBe(1);
  });
});

describe('getTriggerHref', () => {
  it('reads href from link-like triggers', () => {
    expect(getTriggerHref(createElement('a', { href: '/movies/1' }))).toBe('/movies/1');
  });

  it('returns undefined for non-link triggers', () => {
    expect(getTriggerHref(createElement('div', { role: 'button' }))).toBeUndefined();
  });
});

describe('resolveOpenInNewTabTarget', () => {
  it('prefers a primary open action over later hrefs', () => {
    expect(resolveOpenInNewTabTarget([
      {
        actions: [
          { id: 'edit', label: 'Edit', href: '/edit' },
          { id: 'open', label: 'Open', href: '/movies/1' },
          { id: 'imdb', label: 'IMDb', href: 'https://imdb.com', external: true },
        ],
      },
    ])).toEqual({ href: '/movies/1', external: undefined });
  });

  it('prefers an internal href when no primary open action exists', () => {
    expect(resolveOpenInNewTabTarget([
      {
        actions: [
          { id: 'imdb', label: 'IMDb', href: 'https://imdb.com', external: true },
          { id: 'files', label: 'Files', href: '/movies/1/files' },
        ],
      },
    ])).toEqual({ href: '/movies/1/files', external: false });
  });

  it('falls back to the trigger href when actions have no navigable href', () => {
    expect(resolveOpenInNewTabTarget(
      [{ actions: [deleteAction, { id: 'refresh', label: 'Refresh', onSelect: () => {} }] }],
      '/series/9',
    )).toEqual({ href: '/series/9' });
  });

  it('returns null when nothing is navigable', () => {
    expect(resolveOpenInNewTabTarget(
      [{ actions: [deleteAction, { id: 'refresh', label: 'Refresh', onSelect: () => {} }] }],
    )).toBeNull();
  });

  it('ignores disabled and pending href actions', () => {
    expect(resolveOpenInNewTabTarget([
      {
        actions: [
          { id: 'open', label: 'Open', href: '/a', disabled: true },
          { id: 'go-to-item', label: 'Go', href: '/b', pending: true },
        ],
      },
    ], '/trigger')).toEqual({ href: '/trigger' });
  });
});

describe('resolveOpenInNewTabUrl', () => {
  it('resolves relative paths against the current origin', () => {
    vi.stubGlobal('location', { origin: 'https://helprr.test' });
    // URL reads window.location in browsers; in Node it needs a base via the
    // second arg which uses our window.location.origin helper path.
    vi.stubGlobal('window', { location: { origin: 'https://helprr.test' } });
    expect(resolveOpenInNewTabUrl('/movies/1')).toBe('https://helprr.test/movies/1');
  });

  it('keeps absolute urls intact', () => {
    vi.stubGlobal('window', { location: { origin: 'https://helprr.test' } });
    expect(resolveOpenInNewTabUrl('https://example.com/x')).toBe('https://example.com/x');
  });
});
