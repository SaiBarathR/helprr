import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

const VALID_TYPES = new Set(['SONARR', 'RADARR', 'QBITTORRENT', 'PROWLARR', 'JELLYFIN', 'TMDB']);

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const type = body.type;
  if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
    return NextResponse.json({ error: 'Invalid service type' }, { status: 400 });
  }

  const rawUrl = body.externalUrl;
  const externalUrl = typeof rawUrl === 'string' && rawUrl.trim()
    ? rawUrl.trim().replace(/\/+$/, '')
    : null;

  try {
    const existing = await prisma.serviceConnection.findUnique({ where: { type: type as 'SONARR' } });
    if (!existing) {
      return NextResponse.json({ error: 'Service not configured' }, { status: 404 });
    }

    const updated = await prisma.serviceConnection.update({
      where: { type: type as 'SONARR' },
      data: { externalUrl },
    });

    return NextResponse.json({ type: updated.type, externalUrl: updated.externalUrl });
  } catch (error) {
    console.error('Failed to update external URL:', error);
    return NextResponse.json({ error: 'Failed to update external URL' }, { status: 500 });
  }
}
