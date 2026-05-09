import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { writeLog, type LogLevel } from '@/lib/logger';
import { withApiLogging } from '@/lib/api-logger';

interface ClientLogPayload {
  level?: string;
  message?: string;
  metadata?: unknown;
  source?: string;
}

function normalizeLevel(level: unknown): LogLevel {
  return level === 'debug' || level === 'info' || level === 'warn' || level === 'error' ? level : 'info';
}

async function postHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const settings = await getOrCreateAppSettings();
  if (!settings.logClientConsoleEnabled) {
    return NextResponse.json({ accepted: 0 });
  }

  const body = await request.json().catch(() => null) as { logs?: ClientLogPayload[] } | null;
  const logs = Array.isArray(body?.logs) ? body.logs.slice(0, 100) : [];
  for (const item of logs) {
    writeLog(
      normalizeLevel(item.level),
      typeof item.message === 'string' ? item.message : 'Client log',
      item.metadata,
      {
        source: item.source === 'service-worker' ? 'service-worker' : 'client',
        scope: 'browser',
      }
    );
  }

  return NextResponse.json({ accepted: logs.length });
}

export const POST = withApiLogging(postHandler, 'api/logs/client');
