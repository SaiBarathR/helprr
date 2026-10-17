import type { ImageCacheDiagnostics } from '@/lib/cache/image-cache-accounting';

export interface CacheUsageStats {
  imageBytes: number;
  tmdbApiBytes: number;
  anilistApiBytes: number;
  apiBytes: number;
  totalBytes: number;
  imageFiles: number;
  tmdbEntries: number;
  anilistEntries: number;
  apiEntries: number;
  imageDiagnostics: ImageCacheDiagnostics | null;
}

export function parseUsage(raw: unknown): CacheUsageStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Partial<CacheUsageStats>;
  // A payload without a numeric total is malformed — treat as unavailable
  // rather than rendering it as a healthy 0 B.
  if (typeof u.totalBytes !== 'number') return null;
  return {
    imageBytes: typeof u.imageBytes === 'number' ? u.imageBytes : 0,
    tmdbApiBytes: typeof u.tmdbApiBytes === 'number' ? u.tmdbApiBytes : 0,
    anilistApiBytes: typeof u.anilistApiBytes === 'number' ? u.anilistApiBytes : 0,
    apiBytes: typeof u.apiBytes === 'number' ? u.apiBytes : 0,
    totalBytes: typeof u.totalBytes === 'number' ? u.totalBytes : 0,
    imageFiles: typeof u.imageFiles === 'number' ? u.imageFiles : 0,
    tmdbEntries: typeof u.tmdbEntries === 'number' ? u.tmdbEntries : 0,
    anilistEntries: typeof u.anilistEntries === 'number' ? u.anilistEntries : 0,
    apiEntries: typeof u.apiEntries === 'number' ? u.apiEntries : 0,
    imageDiagnostics:
      u.imageDiagnostics
      && typeof u.imageDiagnostics === 'object'
      && typeof u.imageDiagnostics.accountingAvailable === 'boolean'
        ? u.imageDiagnostics
        : null,
  };
}
