import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';

export async function GET() {
  try {
    const client = await getJellyfinClient();
    const users = await client.getUsers();
    return NextResponse.json({ users });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch users';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
