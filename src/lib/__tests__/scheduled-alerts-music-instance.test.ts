import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveConnection: vi.fn() }));
vi.mock('@/lib/arr-instances', () => ({ resolveConnection: mocks.resolveConnection }));

import { pinMusicInstance } from '@/lib/scheduled-alerts/helpers';
import type { ScheduledAlertDraft } from '@/lib/scheduled-alerts/types';

const artist: ScheduledAlertDraft = { source: 'LIDARR', externalId: '9', mediaType: 'music', title: 'Massive Attack' };

// Lidarr ids repeat across instances: an alert made on the default instance stays on it.
describe('pinMusicInstance', () => {
  it('ties a music alert without an instance to the default Lidarr', async () => {
    mocks.resolveConnection.mockResolvedValueOnce({ id: 'lid-default' });
    expect(await pinMusicInstance(artist)).toMatchObject({ instanceId: 'lid-default' });
    expect(mocks.resolveConnection).toHaveBeenCalledWith('LIDARR');
  });

  it('keeps a named instance, leaves other media alone, and keeps none when Lidarr is not set up', async () => {
    mocks.resolveConnection.mockClear();
    expect(await pinMusicInstance({ ...artist, instanceId: 'lid-2' })).toMatchObject({ instanceId: 'lid-2' });
    const movie: ScheduledAlertDraft = { source: 'RADARR', externalId: '5', mediaType: 'movie', title: 'Film' };
    expect(await pinMusicInstance(movie)).toBe(movie);
    expect(mocks.resolveConnection).not.toHaveBeenCalled();

    mocks.resolveConnection.mockRejectedValueOnce(new Error('LIDARR is not configured.'));
    expect((await pinMusicInstance(artist)).instanceId).toBeUndefined();
  });
});
