import { NextResponse } from 'next/server';
import { logger, redact } from '@/lib/logger';

interface ApiLoggingPrefs {
  failedRequestBodies: boolean;
  failedResponseBodies: boolean;
}

let prefs: ApiLoggingPrefs = {
  failedRequestBodies: false,
  failedResponseBodies: false,
};

const MAX_BODY_PREVIEW_CHARS = 20_000;

export function configureApiLogging(next: Partial<ApiLoggingPrefs>): void {
  prefs = { ...prefs, ...next };
}

function getRequest(input: unknown): Request | null {
  return input instanceof Request ? input : null;
}

async function readBodyPreview(requestOrResponse: Request | Response): Promise<unknown> {
  const contentType = requestOrResponse.headers.get('content-type') || '';
  if (!contentType.includes('application/json') && !contentType.startsWith('text/')) {
    return { skipped: true, reason: `content-type ${contentType || 'unknown'}` };
  }

  const text = await requestOrResponse.text().catch(() => '');
  const truncated = text.length > MAX_BODY_PREVIEW_CHARS;
  const body = truncated ? text.slice(0, MAX_BODY_PREVIEW_CHARS) : text;
  if (contentType.includes('application/json')) {
    try {
      return {
        body: redact(JSON.parse(body)),
        truncated,
      };
    } catch {
      return { body: redact(body), truncated, parseError: true };
    }
  }

  return { body: redact(body), truncated };
}

function requestMetadata(request: Request | null) {
  if (!request) return {};
  const url = new URL(request.url);
  return {
    method: request.method,
    path: `${url.pathname}${url.search}`,
    userAgent: request.headers.get('user-agent') || undefined,
  };
}

export interface ApiLoggingOptions {
  // When false, never log request or response bodies for this route, regardless
  // of the global pref. Use for credential-handling routes (auth, service config,
  // OAuth callbacks).
  logBodies?: boolean;
}

export function withApiLogging<T extends (...args: never[]) => Promise<Response> | Response>(
  handler: T,
  scope?: string,
  options: ApiLoggingOptions = {}
): T {
  const allowBodies = options.logBodies !== false;
  return (async (...args: Parameters<T>) => {
    const requestArg = (args as unknown[])[0];
    const request = getRequest(requestArg);
    const requestClone = request ? request.clone() : null;
    const startedAt = performance.now();
    const requestId = crypto.randomUUID();
    const meta = requestMetadata(request);

    try {
      const response = await handler(...args);
      const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
      const status = response.status;
      const failed = status >= 400;
      const extra: Record<string, unknown> = {
        ...meta,
        status,
        durationMs,
      };

      if (failed && allowBodies && requestClone && prefs.failedRequestBodies) {
        extra.requestBody = await readBodyPreview(requestClone);
      }
      if (failed && allowBodies && prefs.failedResponseBodies) {
        extra.responseBody = await readBodyPreview(response.clone());
      }

      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      logger[level]('API request completed', extra, {
        scope: scope ?? 'api',
        requestId,
      });
      response.headers.set('x-request-id', requestId);
      return response;
    } catch (error) {
      const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
      const extra: Record<string, unknown> = {
        ...meta,
        status: 500,
        durationMs,
        error,
      };
      if (allowBodies && requestClone && prefs.failedRequestBodies) {
        extra.requestBody = await readBodyPreview(requestClone);
      }
      logger.error('API request failed', extra, {
        scope: scope ?? 'api',
        requestId,
      });
      return NextResponse.json(
        { error: 'Internal server error', requestId },
        { status: 500, headers: { 'x-request-id': requestId } }
      );
    }
  }) as T;
}
