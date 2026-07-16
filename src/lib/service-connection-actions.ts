import { ApiError } from '@/lib/query-fetch';

async function serviceConnectionMutation(
  id: string,
  init: RequestInit,
  fallback: string,
): Promise<void> {
  const res = await fetch(`/api/services/${id}`, init);
  if (res.ok) return;

  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new ApiError(res.status, body?.error ?? fallback);
}

export async function setServiceConnectionDefault(id: string): Promise<void> {
  await serviceConnectionMutation(id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isDefault: true }),
  }, 'Failed to set default');
}

export async function deleteServiceConnection(id: string): Promise<void> {
  await serviceConnectionMutation(id, { method: 'DELETE' }, 'Failed to remove instance');
}
