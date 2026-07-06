import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Container liveness probe (docker-compose healthcheck). No auth, no DB —
// a 200 just proves the Node process is still serving requests.
export function GET() {
  return NextResponse.json({ status: 'ok' });
}
