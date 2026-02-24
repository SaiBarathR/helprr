import { NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const client = await getRadarrClient();
    const folders = await client.getRootFolders();
    return NextResponse.json(folders);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch root folders';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
