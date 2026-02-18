import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

export async function GET() {
  try {
    const connections = await prisma.serviceConnection.findMany({
      orderBy: { type: 'asc' },
    });

    const masked = connections.map((conn) => ({
      ...conn,
      apiKey: maskApiKey(conn.apiKey),
    }));

    return NextResponse.json(masked);
  } catch (error) {
    console.error('Failed to fetch service connections:', error);
    return NextResponse.json(
      { error: 'Failed to fetch service connections' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, url, apiKey, username } = body;

    if (!type || !url || !apiKey) {
      return NextResponse.json(
        { error: 'type, url, and apiKey/password are required' },
        { status: 400 }
      );
    }

    if (!['SONARR', 'RADARR', 'QBITTORRENT', 'PROWLARR'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid service type' },
        { status: 400 }
      );
    }

    const connection = await prisma.serviceConnection.upsert({
      where: { type },
      update: {
        url: url.replace(/\/+$/, ''),
        apiKey,
        username: type === 'QBITTORRENT' ? (username || 'admin') : null,
      },
      create: {
        type,
        url: url.replace(/\/+$/, ''),
        apiKey,
        username: type === 'QBITTORRENT' ? (username || 'admin') : null,
      },
    });

    return NextResponse.json({
      ...connection,
      apiKey: maskApiKey(connection.apiKey),
    });
  } catch (error) {
    console.error('Failed to save service connection:', error);
    return NextResponse.json(
      { error: 'Failed to save service connection' },
      { status: 500 }
    );
  }
}
