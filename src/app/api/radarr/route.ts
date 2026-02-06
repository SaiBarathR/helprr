import { NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';

export async function GET() {
  try {
    const client = await getRadarrClient();
    const movies = await client.getMovies();
    return NextResponse.json(movies);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch movies';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const client = await getRadarrClient();
    const result = await client.addMovie(body);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add movie';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
