import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get('itemId');
    const type = searchParams.get('type') || 'Primary';
    const maxWidth = searchParams.get('maxWidth') || '300';
    const quality = searchParams.get('quality') || '90';

    if (!itemId) {
      return NextResponse.json({ error: 'itemId is required' }, { status: 400 });
    }

    const connection = await prisma.serviceConnection.findUnique({
      where: { type: 'JELLYFIN' },
    });

    if (!connection) {
      return new NextResponse(null, { status: 404 });
    }

    const url = `${connection.url.replace(/\/+$/, '')}/Items/${itemId}/Images/${type}?maxWidth=${maxWidth}&quality=${quality}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `MediaBrowser Token="${connection.apiKey}"`,
      },
    });

    if (!response.ok) {
      return new NextResponse(null, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
