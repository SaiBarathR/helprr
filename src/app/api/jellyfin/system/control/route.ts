import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { action } = (await req.json()) as { action: string };
    const client = await getJellyfinClient();

    switch (action) {
      case 'restart':
        await client.restartServer();
        break;
      case 'shutdown':
        await client.shutdownServer();
        break;
      case 'scan-libraries':
        await client.scanAllLibraries();
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to execute action';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
