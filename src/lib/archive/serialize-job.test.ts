import { describe, expect, it } from 'vitest';
import { JOB_SELECT, serializeJob, type JobRow } from './serialize-job';

const job = {
  id: 'job-1',
  bytesDone: BigInt(10),
  bytesTotal: BigInt(20),
  video: {
    id: 'video-1',
    externalId: '100',
    title: 'A stream',
    thumbnailUrl: 'https://static-cdn.jtvnw.net/thumb-%{width}x%{height}.jpg',
    durationSeconds: 60,
    creator: { id: 'streamer-1', displayName: 'Gigguk' },
  },
} as JobRow;

describe('serializeJob', () => {
  it('fills in the size placeholders Helix leaves in thumbnail URLs', () => {
    expect(serializeJob(job).video?.thumbnailUrl).toBe('https://static-cdn.jtvnw.net/thumb-320x180.jpg');
  });

  it('turns byte counts into numbers, which survive JSON', () => {
    expect(serializeJob(job)).toMatchObject({ bytesDone: 10, bytesTotal: 20 });
  });

  it('never selects the worker error, which can hold a path', () => {
    expect(JOB_SELECT).not.toHaveProperty('lastError');
  });

  it('sends the names the pages read', () => {
    expect(serializeJob(job).video).toEqual({
      id: 'video-1',
      externalId: '100',
      title: 'A stream',
      thumbnailUrl: 'https://static-cdn.jtvnw.net/thumb-320x180.jpg',
      durationSeconds: 60,
      creator: { id: 'streamer-1', displayName: 'Gigguk' },
    });
  });

  it('keeps a job whose video is gone', () => {
    expect(serializeJob({ ...job, video: null }).video).toBeNull();
  });
});
