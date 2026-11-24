'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { handleAuthError } from '@/lib/query-client';
import type { QBittorrentCategory, SavePathPreferences } from '@/lib/qbittorrent-client';
import type { ArrCategoryUse } from '@/lib/qbittorrent-category-usage';

/** With qBittorrent's save-path settings (subcategory mode: "a/b" is a child of "a", removed with it). */
export interface CategoryDetails extends SavePathPreferences {
  categories: Record<string, QBittorrentCategory>;
  /** Where a category with no save path of its own saves: <this>/<name>. */
  defaultSavePath: string;
}

// Under ['qbittorrent', 'categories'], so invalidating that also refreshes the add page's list.
export const CATEGORY_DETAILS_KEY = ['qbittorrent', 'categories', 'details'] as const;
const CATEGORIES_URL = '/api/qbittorrent/categories';

export function useCategoryDetails() {
  return useQuery({
    queryKey: CATEGORY_DETAILS_KEY,
    queryFn: jsonFetcher<CategoryDetails>(`${CATEGORIES_URL}?details=1`),
    staleTime: 0,
  });
}

export type CategoryChangeResult =
  | { ok: true }
  | {
    ok: false;
    error: string;
    /** The form field the error is about, when the server says. */
    field?: 'name' | 'savePath';
    needsConfirm?: boolean;
    uses?: ArrCategoryUse[];
    unchecked?: string[];
  };

/** Create (POST), save (PATCH) or remove (DELETE); a 401 goes to sign-in like other mutations. */
export async function sendCategoryChange(
  method: 'POST' | 'PATCH' | 'DELETE',
  body: Record<string, unknown>,
): Promise<CategoryChangeResult> {
  let res: Response;
  try {
    res = await fetch(CATEGORIES_URL, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'Helprr could not be reached' };
  }
  if (res.status === 401) {
    handleAuthError(new ApiError(401, `${CATEGORIES_URL} → 401`));
    return { ok: false, error: 'Signed out' };
  }
  if (res.ok) return { ok: true };
  const data = (await res.json().catch(() => null)) as Partial<Extract<CategoryChangeResult, { ok: false }>> | null;
  return {
    ok: false,
    error: typeof data?.error === 'string' ? data.error : 'qBittorrent did not take the change',
    field: data?.field === 'name' || data?.field === 'savePath' ? data.field : undefined,
    needsConfirm: data?.needsConfirm === true,
    uses: Array.isArray(data?.uses) ? data.uses : [],
    unchecked: Array.isArray(data?.unchecked) ? data.unchecked : [],
  };
}
