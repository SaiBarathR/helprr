import { NextRequest, NextResponse } from 'next/server';
import { SonarrClient } from '@/lib/sonarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { QBittorrentClient } from '@/lib/qbittorrent-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, url, apiKey, username } = body;

    if (!type || !url || !apiKey) {
      return NextResponse.json(
        { success: false, error: 'type, url, and apiKey/password are required' },
        { status: 400 }
      );
    }

    const cleanUrl = url.replace(/\/+$/, '');

    switch (type) {
      case 'SONARR': {
        const client = new SonarrClient(cleanUrl, apiKey);
        const status = await client.getSystemStatus();
        return NextResponse.json({
          success: true,
          version: status.version,
        });
      }

      case 'RADARR': {
        const client = new RadarrClient(cleanUrl, apiKey);
        const status = await client.getSystemStatus();
        return NextResponse.json({
          success: true,
          version: status.version,
        });
      }

      case 'QBITTORRENT': {
        const client = new QBittorrentClient(cleanUrl, apiKey, username || 'admin');
        const version = await client.getVersion();
        return NextResponse.json({
          success: true,
          version,
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid service type' },
          { status: 400 }
        );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Connection failed';
    return NextResponse.json(
      { success: false, error: message },
      { status: 200 }
    );
  }
}
