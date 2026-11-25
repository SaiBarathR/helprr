import { Readable } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import { arrSystemAdminApi } from '@/lib/arr-system-admin-api';

// The calls each Sonarr/Radarr/Lidarr/Prowlarr client makes for restart, shut
// down and System → Backup: the right API root, multipart for an upload, and a
// stream for a download.

const http = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
const client = http as unknown as AxiosInstance;

beforeEach(() => {
  vi.clearAllMocks();
  http.get.mockResolvedValue({ data: [], headers: {} });
  http.post.mockResolvedValue({ data: {} });
  http.delete.mockResolvedValue({ data: {} });
});

describe.each([['/api/v3'], ['/api/v1']] as const)('under %s', (prefix) => {
  const api = arrSystemAdminApi(client, prefix);

  it('restarts and shuts down', async () => {
    await api.power('restart');
    await api.power('shutdown');
    expect(http.post.mock.calls.map((c) => c[0])).toEqual([`${prefix}/system/restart`, `${prefix}/system/shutdown`]);
  });

  it('lists, deletes and restores backups by id, giving a restore longer', async () => {
    http.get.mockResolvedValue({ data: [{ id: 1 }], headers: {} });
    expect(await api.getBackups()).toEqual([{ id: 1 }]);
    expect(http.get).toHaveBeenCalledWith(`${prefix}/system/backup`);
    await api.deleteBackup(7);
    expect(http.delete).toHaveBeenCalledWith(`${prefix}/system/backup/7`);
    await api.restoreBackup(7);
    expect(http.post).toHaveBeenCalledWith(`${prefix}/system/backup/restore/7`, undefined, { timeout: 120_000 });
  });

  it('reads a list that is not an array as none', async () => {
    http.get.mockResolvedValue({ data: { message: 'nope' }, headers: {} });
    expect(await api.getBackups()).toEqual([]);
  });

  it('sends an upload as multipart, not as the clients\' default JSON', async () => {
    await api.restoreUploadedBackup(new Blob(['PK']), 'backup.zip');
    const [url, form, config] = http.post.mock.calls[0];
    expect(url).toBe(`${prefix}/system/backup/restore/upload`);
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get('file')).toBeInstanceOf(Blob);
    expect(((form as FormData).get('file') as File).name).toBe('backup.zip');
    expect(config).toEqual({ headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 });
  });

  it('streams a download from the path it is given, with its content type', async () => {
    const stream = Readable.from(['PK']);
    http.get.mockResolvedValue({ data: stream, headers: { 'content-type': 'application/zip', 'content-length': '2' } });
    expect(await api.downloadBackup('/backup/manual/a.zip')).toEqual({ stream, contentType: 'application/zip' });
    expect(http.get).toHaveBeenCalledWith('/backup/manual/a.zip', { responseType: 'stream' });
  });
});
