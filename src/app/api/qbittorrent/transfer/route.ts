import { NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';

export async function GET() {
  try {
    const client = await getQBittorrentClient();
    const info = await client.getTransferInfo();
    return NextResponse.json(info);
  } catch (error) {
    console.error('Failed to fetch transfer info:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transfer info' },
      { status: 500 }
    );
  }
}
