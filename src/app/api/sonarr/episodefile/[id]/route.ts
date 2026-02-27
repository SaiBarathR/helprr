import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const episodeFileId = Number(id);
    if (!Number.isFinite(episodeFileId) || episodeFileId <= 0) {
      return NextResponse.json({ error: 'Invalid episode file id' }, { status: 400 });
    }

    const client = await getSonarrClient();
    await client.deleteEpisodeFile(episodeFileId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete episode file';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
