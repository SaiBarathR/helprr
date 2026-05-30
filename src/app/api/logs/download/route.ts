import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireCapability } from '@/lib/auth';
import { getSafeLogFilePath, streamFilteredLogs } from '@/lib/logger';
import { withApiLogging } from '@/lib/api-logger';

const ALLOWED_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const ALLOWED_SOURCES = new Set(['server', 'client', 'service-worker']);

function parseCsv(raw: string | null, allowed: Set<string>): string[] | undefined {
  if (!raw) return undefined;
  const values = raw.split(',').map((v) => v.trim()).filter((v) => v && allowed.has(v));
  return values.length > 0 ? values : undefined;
}

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('logs.view');
  if (capError) return capError;

  const params = request.nextUrl.searchParams;
  const file = params.get('file');
  const levels = parseCsv(params.get('level'), ALLOWED_LEVELS);
  const sources = parseCsv(params.get('source'), ALLOWED_SOURCES);
  const q = params.get('q') || undefined;
  const from = params.get('from') || undefined;
  const to = params.get('to') || undefined;

  const hasFilters = Boolean(levels || sources || q || from || to);
  const hasSingleFile = Boolean(file && file !== 'all');

  if (!hasFilters && hasSingleFile) {
    let fullPath: string;
    try {
      fullPath = getSafeLogFilePath(file!);
    } catch {
      return NextResponse.json({ error: 'Invalid log file' }, { status: 400 });
    }

    const bytes = await fs.promises.readFile(fullPath).catch(() => null);
    if (!bytes) {
      return NextResponse.json({ error: 'Log file not found' }, { status: 404 });
    }

    return new NextResponse(bytes, {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'content-disposition': `attachment; filename="${path.basename(file!)}"`,
      },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await streamFilteredLogs(
          {
            q,
            level: levels,
            source: sources,
            file: hasSingleFile ? file! : undefined,
            from,
            to,
          },
          (line) => {
            controller.enqueue(encoder.encode(`${line}\n`));
          }
        );
      } catch (error) {
        controller.error(error);
        return;
      }
      controller.close();
    },
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = hasFilters ? `helprr-filtered-${stamp}.jsonl` : `helprr-all-${stamp}.jsonl`;

  return new NextResponse(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}

export const GET = withApiLogging(getHandler, 'api/logs/download');
