import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { discoverImportCandidates, importServices, type ImportItem } from '@/lib/service-import';
import { recordSecurityEvent, serviceTargetLabel } from '@/lib/security-audit';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const MAX_ITEMS = 20;

// Admin only: the Sonarr, Radarr and Lidarr servers Seerr and Prowlarr know about.
// No key ever leaves the server.
async function getHandler(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  return NextResponse.json(await discoverImportCandidates(), { headers: NO_STORE });
}

function parseItems(body: unknown): ImportItem[] | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) return null;
  const parsed: ImportItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') return null;
    const { id, label, url, apiKey } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !id) return null;
    for (const value of [label, url, apiKey]) if (value !== undefined && typeof value !== 'string') return null;
    parsed.push({ id, label: label as string | undefined, url: url as string | undefined, apiKey: apiKey as string | undefined });
  }
  return parsed;
}

// Tests each chosen app from Helprr, then adds it as a new instance.
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const items = parseItems(await request.json().catch(() => null));
  if (!items) return NextResponse.json({ error: `Send 1 to ${MAX_ITEMS} apps to add.` }, { status: 400 });
  const results = await importServices(items, (connection) => recordSecurityEvent(request, {
    actor: admin.user,
    action: 'SERVICE_CREATED',
    targetType: 'service',
    targetId: connection.id,
    targetLabel: serviceTargetLabel(connection.type, connection.label),
    fields: ['url', 'apiKey'],
  }));
  return NextResponse.json({ results }, { headers: NO_STORE });
}

export const GET = withApiLogging(getHandler, 'api/services/import');
// The body can hold typed API keys.
export const POST = withApiLogging(postHandler, 'api/services/import', { logBodies: false });
