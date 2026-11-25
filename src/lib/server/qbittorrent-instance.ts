import { NextResponse } from 'next/server';
import { listConnections } from '@/lib/arr-instances';

/**
 * The qBittorrent a request names with `?instanceId=`, checked before any
 * upstream call. Helprr can have several qBittorrents, and a hash, a category
 * or a setting belongs to one of them, so a named instance must be one of the
 * qBittorrent connections: it is never swapped for the default. A request
 * that names none acts on the default instance, as before there were several.
 */
export async function qbittorrentInstanceParam(
  value: string | null | undefined,
): Promise<{ ok: true; instanceId: string | undefined } | { ok: false; response: NextResponse }> {
  if (value === null || value === undefined) return { ok: true, instanceId: undefined };
  if (!value || value.length > 128) {
    return { ok: false, response: NextResponse.json({ error: 'Invalid instanceId' }, { status: 400 }) };
  }
  const connections = await listConnections('QBITTORRENT');
  if (!connections.some((connection) => connection.id === value)) {
    return { ok: false, response: NextResponse.json({ error: 'Unknown qBittorrent instance' }, { status: 400 }) };
  }
  return { ok: true, instanceId: value };
}

/** {@link qbittorrentInstanceParam} for a request's `?instanceId=`. */
export function qbittorrentInstanceOf(request: Request) {
  return qbittorrentInstanceParam(new URL(request.url).searchParams.get('instanceId'));
}
