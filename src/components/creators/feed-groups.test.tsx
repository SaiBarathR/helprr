// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CreatorVideoItem } from './types';
import type { VideoActions } from './use-video-actions';

vi.mock('@/components/media/fade-in-image', () => ({ FadeInImage: () => null }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

import { FeedGroups, type FeedGroup } from './feed-groups';
import { CreatorPlatformProvider } from './platform';

const video = (id: string, title: string, daysAgo: number) => ({
  id, type: 'UPLOAD', title, sourceCreatedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(), durationSeconds: 600,
  thumbnailUrl: null, mutedSegments: null, availability: 'PUBLISHED', estimatedExpiresAt: null,
  creator: { id: 'c1', displayName: 'Linus Tech Tips' }, downloaded: false, activeJob: null,
}) as unknown as CreatorVideoItem;

const group: FeedGroup = {
  creator: { id: 'c1', login: 'linustechtips', displayName: 'Linus Tech Tips', profileImageUrl: null },
  total: 37,
  newCount: 3,
  videos: [video('v1', 'GTA 6 on PC', 1), video('v2', 'I Doubled My GPU Memory', 2)],
};

const actions = { groupsFor: () => [], swipeFor: () => ({}) } as unknown as VideoActions;
const selection = { selectionFor: () => undefined, startWith: () => () => undefined } as never;

function show(groups: FeedGroup[]) {
  return render(<CreatorPlatformProvider platform="youtube"><FeedGroups groups={groups} actions={actions} selection={selection} /></CreatorPlatformProvider>);
}

describe('FeedGroups', () => {
  it('names each channel with its new count and newest video, linking to its page', () => {
    show([group]);
    const header = screen.getByRole('link', { name: /Linus Tech Tips/ });
    expect(header.getAttribute('href')).toBe('/youtube/channels/c1');
    expect(header.textContent).toContain('3 new');
    expect(header.textContent).toContain('latest 1 day ago');
  });

  it('shows the videos without repeating the channel on each card', () => {
    show([group]);
    expect(screen.getByText('GTA 6 on PC')).toBeTruthy();
    const section = screen.getByRole('region', { name: 'Linus Tech Tips' });
    expect(section.textContent?.match(/Linus Tech Tips/g)).toHaveLength(1);
  });

  it('ends each row with See all and the full count', () => {
    show([group]);
    const seeAll = screen.getByRole('link', { name: /See all/ });
    expect(seeAll.getAttribute('href')).toBe('/youtube/channels/c1');
    expect(seeAll.textContent).toContain('37 videos');
  });

  it('leaves the count out when nothing is new', () => {
    show([{ ...group, newCount: 0 }]);
    expect(screen.getByRole('link', { name: /Linus Tech Tips/ }).textContent).not.toContain('new');
  });
});
