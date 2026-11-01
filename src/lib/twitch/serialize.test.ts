import { describe, expect, it } from 'vitest';
import { serializeVideo, type VideoRow } from './serialize';

const createdAt = new Date('2026-10-30T10:00:00Z');
const video = {
  id: 'video-1',
  externalId: '100',
  sourceCreatedAt: createdAt,
  thumbnailUrl: 'https://static-cdn.jtvnw.net/thumb-%{width}x%{height}.jpg',
  creator: { id: 'streamer-1', login: 'gigguk', displayName: 'Gigguk', profileImageUrl: null, isLive: false },
  mediaFiles: [],
  jobs: [],
} as unknown as VideoRow;

describe('serializeVideo', () => {
  it('sends the names the pages read', () => {
    const result = serializeVideo(video);
    expect(result).toMatchObject({ externalId: '100', sourceCreatedAt: createdAt, creator: video.creator });
    for (const name of ['twitchVideoId', 'twitchCreatedAt', 'streamer']) expect(result).not.toHaveProperty(name);
  });
});
