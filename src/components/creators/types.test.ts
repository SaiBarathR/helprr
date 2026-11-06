import { describe, expect, it } from 'vitest';
import { canChooseDownload, fileQuality, formatGb, isWaitingRuleJob, jobBadge, JOB_STATE_BADGES, stageLabel, startsLabel } from './types';

describe('formatGb', () => {
  it('keeps a short clip from rounding to nothing', () => {
    expect(formatGb(0.002)).toBe('3 MB');
  });

  it('switches to GB at 1 GB', () => {
    expect(formatGb(0.5)).toBe('512 MB');
    expect(formatGb(9.74)).toBe('9.7 GB');
  });
});

describe('fileQuality', () => {
  it('names a file by its shape, not its height', () => {
    expect(fileQuality({ width: 1280, height: 640 })).toBe('720p');
    expect(fileQuality({ width: 3840, height: 1920 })).toBe('4K');
    expect(fileQuality({ width: 1080, height: 1920 })).toBe('1080p');
  });

  it('keeps to the height for a file saved before widths were recorded', () => {
    expect(fileQuality({ width: null, height: 1080 })).toBe('1080p');
    expect(fileQuality({ width: null, height: null })).toBeNull();
  });
});

describe('stageLabel', () => {
  it('capitalises what the worker reports', () => {
    expect(stageLabel('reading metadata')).toBe('Reading metadata');
  });
});

describe('startsLabel', () => {
  // Local times, so the test holds in any time zone.
  const now = new Date(2026, 10, 6, 12, 0);
  const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

  it('gives just the time for a job starting later today', () => {
    const at = new Date(2026, 10, 6, 15, 40);
    expect(startsLabel({ state: 'QUEUED', runAfter: at.toISOString() }, now)).toBe(`Starts ${at.toLocaleTimeString(undefined, time)}`);
  });

  it('adds the day for a job starting another day', () => {
    const at = new Date(2026, 10, 7, 9, 5);
    const label = startsLabel({ state: 'QUEUED', runAfter: at.toISOString() }, now);
    expect(label).toBe(`Starts ${at.toLocaleString(undefined, { month: 'short', day: 'numeric', ...time })}`);
    expect(label).toContain('7');
  });

  it('says nothing once the time has passed, or for a job that is not simply queued', () => {
    expect(startsLabel({ state: 'QUEUED', runAfter: new Date(2026, 10, 6, 11, 59).toISOString() }, now)).toBeNull();
    expect(startsLabel({ state: 'QUEUED', runAfter: now.toISOString() }, now)).toBeNull();
    expect(startsLabel({ state: 'QUEUED' }, now)).toBeNull();
    expect(startsLabel({ state: 'RETRY_WAIT', runAfter: new Date(2026, 10, 6, 15, 0).toISOString() }, now)).toBeNull();
  });
});

describe('isWaitingRuleJob', () => {
  const now = new Date(2026, 10, 6, 12, 0);
  const later = new Date(2026, 10, 6, 15, 0).toISOString();

  it('is only a rule download still waiting for its time', () => {
    expect(isWaitingRuleJob({ state: 'QUEUED', source: 'RULE', runAfter: later }, now)).toBe(true);
    expect(isWaitingRuleJob({ state: 'QUEUED', source: 'MANUAL', runAfter: later }, now)).toBe(false);
    expect(isWaitingRuleJob({ state: 'RUNNING', source: 'RULE', runAfter: later }, now)).toBe(false);
    expect(isWaitingRuleJob({ state: 'QUEUED', source: 'RULE', runAfter: new Date(2026, 10, 6, 11, 0).toISOString() }, now)).toBe(false);
  });
});

describe('jobBadge', () => {
  const now = new Date(2026, 10, 6, 12, 0);
  const later = new Date(2026, 10, 6, 15, 0).toISOString();
  const earlier = new Date(2026, 10, 6, 11, 0).toISOString();

  it('calls only a running job Downloading', () => {
    expect(jobBadge({ state: 'RUNNING', runAfter: earlier }, now)).toEqual(JOB_STATE_BADGES.RUNNING);
    expect(jobBadge({ state: 'RUNNING' }, now).label).toBe('Downloading');
  });

  it('says a queued job still waiting for its time is Waiting, in the Queued colours', () => {
    expect(jobBadge({ state: 'QUEUED', runAfter: later }, now)).toEqual({ label: 'Waiting', className: JOB_STATE_BADGES.QUEUED.className });
  });

  it('says Queued once the time has passed, or with no time at all', () => {
    expect(jobBadge({ state: 'QUEUED', runAfter: earlier }, now).label).toBe('Queued');
    expect(jobBadge({ state: 'QUEUED' }, now).label).toBe('Queued');
  });

  it('uses the Queue page words for a retry and a full disk', () => {
    expect(jobBadge({ state: 'RETRY_WAIT', runAfter: later }, now)).toEqual({ label: 'Retrying soon', className: 'bg-amber-500/15 text-amber-400' });
    expect(jobBadge({ state: 'BLOCKED' }, now)).toEqual({ label: 'Disk full', className: 'bg-amber-500/15 text-amber-400' });
  });
});

describe('canChooseDownload', () => {
  const now = new Date(2026, 10, 6, 12, 0);
  const later = new Date(2026, 10, 6, 15, 0).toISOString();
  const video = { downloaded: false, availability: 'PUBLISHED' as const, activeJob: null };
  const job = { id: 'j', state: 'QUEUED', source: 'RULE', runAfter: later, stage: null, progress: null };

  it('offers a video with nothing saved or under way', () => {
    expect(canChooseDownload(video, now)).toBe(true);
  });

  it('offers a rule download still waiting, to start it now', () => {
    expect(canChooseDownload({ ...video, activeJob: job }, now)).toBe(true);
  });

  it('offers nothing for a download a person queued, one that has started, or one whose time has come', () => {
    expect(canChooseDownload({ ...video, activeJob: { ...job, source: 'MANUAL' } }, now)).toBe(false);
    expect(canChooseDownload({ ...video, activeJob: { ...job, state: 'RUNNING' } }, now)).toBe(false);
    expect(canChooseDownload({ ...video, activeJob: { ...job, runAfter: new Date(2026, 10, 6, 11, 0).toISOString() } }, now)).toBe(false);
  });

  it('offers nothing for a saved or unpublished video', () => {
    expect(canChooseDownload({ ...video, downloaded: true }, now)).toBe(false);
    expect(canChooseDownload({ ...video, availability: 'RECORDING' }, now)).toBe(false);
  });
});
