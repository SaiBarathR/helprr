import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const client = await getRadarrClient();
    const movie = await client.getMovieById(Number(id));
    return NextResponse.json(movie);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch movie';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const client = await getRadarrClient();
    const result = await client.updateMovie(body);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update movie';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const deleteFiles = searchParams.get('deleteFiles') === 'true';
    const client = await getRadarrClient();
    await client.deleteMovie(Number(id), deleteFiles);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete movie';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
