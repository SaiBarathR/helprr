// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DownloadProgressText, nextStep, type ManualDownloadView } from '../manual-download-status';

const download = (extra: Partial<ManualDownloadView> = {}): ManualDownloadView => ({
  id: 'md1', mode: 'ARR_MANAGED', status: 'DOWNLOADING', service: 'RADARR',
  instanceId: 'r1', instanceLabel: 'RADARR', externalId: 1, arrItemId: 15,
  arrItemTitle: 'Film', createdArrItem: true, targetEpisodeIds: [], importedFileCount: null,
  releaseTitle: 'Film.2026', source: 'MAGNET', infoHash: 'ABC', torrentName: 'Film',
  downloadClientName: 'qBittorrent', lastError: null, attempts: 0, createdByUsername: 'admin',
  createdAt: '2026-10-29T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z', completedAt: null,
  ...extra,
});

describe('linked download presentation', () => {
  it('shows progress and selected download size without rounding an unfinished torrent to 100%', () => {
    const { rerender } = render(<DownloadProgressText download={download({ progress: { fraction: 0.5, size: 1024 * 1024 } })} />);
    expect(screen.getByText('50% · 512 KB of 1 MB')).toBeTruthy();
    rerender(<DownloadProgressText download={download({ progress: { fraction: 0.9999, size: null } })} />);
    expect(screen.getByText('99%')).toBeTruthy();
    rerender(<DownloadProgressText download={download({ progress: { fraction: 1, size: null } })} />);
    expect(screen.getByText('100%')).toBeTruthy();
    rerender(<DownloadProgressText download={download({ status: 'IMPORTED', progress: { fraction: 1, size: null } })} />);
    expect(screen.queryByText('100%')).toBeNull();
  });

  it.each(['RADARR', 'SONARR'] as const)('uses the %s display name and the proved file count', (service) => {
    const app = service === 'RADARR' ? 'Radarr' : 'Sonarr';
    expect(nextStep(download({ service, status: 'IMPORTED', instanceLabel: service, importedFileCount: 1 }))).toBe(`Film has the new file in ${app}.`);
    expect(nextStep(download({ service, status: 'IMPORTED', instanceLabel: service, importedFileCount: 3 }))).toBe(`Film has 3 new files in ${app}.`);
    expect(nextStep(download({ service, status: 'IMPORTED', importedFileCount: null }))).toBe(`Film has the new files in ${app}.`);
  });

});
