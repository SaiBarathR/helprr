import type { AxiosInstance } from 'axios';
import type { Readable } from 'stream';
import type { ArrPowerAction } from '@/lib/arr-system';

// Restart and shut down (System → Status) and System → Backup, which Sonarr,
// Radarr, Lidarr and Prowlarr share under their own API version. Each client
// builds one on its own connection; only the admin routes under
// /api/admin/arr-system call it, after confirming with the admin.

/** Restoring copies the database out of the zip, which takes a while on a large library. */
const RESTORE_TIMEOUT_MS = 120_000;

export interface ArrBackupFile {
  stream: Readable;
  /** The app's Content-Type, to tell a zip from a sign-in page. */
  contentType: string;
}

export interface ArrSystemAdminApi {
  power(action: ArrPowerAction): Promise<void>;
  /** The app's backups, as it lists them (with their paths: the caller projects them). */
  getBackups(): Promise<unknown[]>;
  deleteBackup(id: number): Promise<void>;
  /** Restores a listed backup. It takes effect when the app restarts. */
  restoreBackup(id: number): Promise<void>;
  /** Restores an uploaded backup zip. It takes effect when the app restarts. */
  restoreUploadedBackup(file: Blob, name: string): Promise<void>;
  /** A listed backup's file, streamed. `path` is the app's own (`/backup/<type>/<name>.zip`), checked by the caller. */
  downloadBackup(path: string): Promise<ArrBackupFile>;
}

/** `prefix` is the app's API root: `/api/v3` (Sonarr, Radarr) or `/api/v1` (Lidarr, Prowlarr). */
export function arrSystemAdminApi(client: AxiosInstance, prefix: '/api/v3' | '/api/v1'): ArrSystemAdminApi {
  return {
    async power(action) {
      await client.post(`${prefix}/system/${action}`);
    },
    async getBackups() {
      const response = await client.get<unknown[]>(`${prefix}/system/backup`);
      return Array.isArray(response.data) ? response.data : [];
    },
    async deleteBackup(id) {
      await client.delete(`${prefix}/system/backup/${id}`);
    },
    async restoreBackup(id) {
      await client.post(`${prefix}/system/backup/restore/${id}`, undefined, { timeout: RESTORE_TIMEOUT_MS });
    },
    async restoreUploadedBackup(file, name) {
      const form = new FormData();
      form.append('file', file, name);
      // The clients default to JSON, and axios would turn a FormData sent as
      // JSON into an object; this makes it send multipart with its own boundary.
      await client.post(`${prefix}/system/backup/restore/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: RESTORE_TIMEOUT_MS,
      });
    },
    async downloadBackup(path) {
      // The backup files sit under the app's URL base, outside its API, and
      // take the same key. No Content-Length is passed on: axios unzips a
      // response a proxy gzipped, and the app's length would then be wrong.
      const response = await client.get<Readable>(path, { responseType: 'stream' });
      return { stream: response.data, contentType: String(response.headers['content-type'] ?? '') };
    },
  };
}
