import { NextResponse } from 'next/server';
import { takeTorrentForArr } from '@/lib/manual-downloads/torrent-link';

/**
 * The .torrent a manual download pushed to Sonarr/Radarr, fetched once by Arr.
 * Public (Arr sends no session); the unguessable, single-use, two-minute token
 * is the credential. Deliberately not wrapped in withApiLogging, so the token
 * in the path is never written to the logs.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const bytes = await takeTorrentForArr(token).catch(() => null);
  if (!bytes) return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/x-bittorrent',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
    },
  });
}
