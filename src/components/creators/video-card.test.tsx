// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CreatorVideoItem } from './types';
import type { VideoActions } from './use-video-actions';

vi.mock('@/components/media/fade-in-image', () => ({ FadeInImage: () => null }));

import { CreatorVideoCard } from './video-card';
import { CreatorPlatformProvider } from './platform';

const video = {
  id: 'video-1',
  type: 'ARCHIVE',
  title: 'A stream',
  sourceCreatedAt: '2026-10-20T00:00:00.000Z',
  durationSeconds: 3600,
  thumbnailUrl: null,
  mutedSegments: null,
  availability: 'PUBLISHED',
  estimatedExpiresAt: null,
  creator: { displayName: 'Gigguk' },
  downloaded: false,
  activeJob: null,
} as unknown as CreatorVideoItem;

describe('CreatorVideoCard', () => {
  it('selects when the checkbox itself is tapped', async () => {
    const onToggle = vi.fn();
    render(<CreatorPlatformProvider platform="twitch"><CreatorVideoCard video={video} layout="grid" actions={{} as VideoActions} selection={{ selected: false, onToggle }} /></CreatorPlatformProvider>);
    const check = screen.getByRole('button', { name: 'Select A stream' }).querySelector('[aria-hidden="true"]');
    await userEvent.click(check as Element);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
