import { ApiError } from '@/lib/query-fetch';
import type { JellyfinScheduledTask } from '@/types/jellyfin';
import type { ServicesStatsResponse } from '@/types/service-stats';
import { fetchOrOffline } from '@/lib/network-error';

export async function fetchServicesStats(signal?: AbortSignal): Promise<ServicesStatsResponse> {
  const response = await fetchOrOffline('/api/services/stats', { signal });
  if (!response.ok) throw new ApiError(response.status, 'Request failed');
  return response.json();
}

export async function fetchJellyfinTasks(signal?: AbortSignal): Promise<JellyfinScheduledTask[]> {
  const response = await fetchOrOffline('/api/jellyfin/tasks', { signal });
  if (!response.ok) throw new ApiError(response.status, 'Request failed');
  const data = await response.json();
  return Array.isArray(data.tasks) ? data.tasks : [];
}
