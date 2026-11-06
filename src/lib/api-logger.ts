import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { withPerformanceScope } from '@/lib/server-perf';
import { runWithRequestContext } from '@/lib/request-context';
import { NextResponse } from 'next/server';
import { logger, redact } from '@/lib/logger';
import { READONLY_API_NETWORK_FIRST } from '@/lib/offline-snapshot';

interface ApiLoggingPrefs {
  enabled: boolean;
  failedRequestBodies: boolean;
  failedResponseBodies: boolean;
}

// Shared across webpack bundles via globalThis — see note in logger.ts.
const API_LOGGING_KEY = '__helprrApiLogging' as const;
const globalScope = globalThis as typeof globalThis & {
  [API_LOGGING_KEY]?: ApiLoggingPrefs;
};

const prefs: ApiLoggingPrefs = globalScope[API_LOGGING_KEY] ?? {
  enabled: true,
  failedRequestBodies: false,
  failedResponseBodies: false,
};
globalScope[API_LOGGING_KEY] = prefs;

const MAX_BODY_PREVIEW_CHARS = 20_000;

export function configureApiLogging(next: Partial<ApiLoggingPrefs>): void {
  if (next.enabled !== undefined) prefs.enabled = Boolean(next.enabled);
  if (next.failedRequestBodies !== undefined) prefs.failedRequestBodies = Boolean(next.failedRequestBodies);
  if (next.failedResponseBodies !== undefined) prefs.failedResponseBodies = Boolean(next.failedResponseBodies);
}

function getRequest(input: unknown): Request | null {
  return input instanceof Request ? input : null;
}

function requestMayHaveBody(request: Request): boolean {
  return request.method !== 'GET' && request.method !== 'HEAD';
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

function requestMetadata(
  request: Request | null,
  redactQueryParams: readonly string[] = [],
) {
  if (!request) return {};
  const url = new URL(request.url);
  for (const name of redactQueryParams) {
    if (url.searchParams.has(name)) url.searchParams.set(name, '[redacted]');
  }
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
  // Query parameters that must not be copied into request logs. Image source
  // URLs and other credential-bearing nested URLs should use this even when
  // request-body logging is disabled.
  redactQueryParams?: readonly string[];
}

// API answers are per user; nothing may be stored unless the route says so.
const DEFAULT_CACHE_CONTROL = 'private, no-store';

function withDefaultCacheControl(response: Response, request: Request | null): Response {
  if (response.headers.has('Cache-Control')) return response;
  // Reads the service worker keeps as offline snapshots must stay storable; no-cache
  // still sends every use back to the server.
  const snapshot = request?.method === 'GET' && READONLY_API_NETWORK_FIRST.test(new URL(request.url).pathname);
  response.headers.set('Cache-Control', snapshot ? 'private, no-cache' : DEFAULT_CACHE_CONTROL);
  return response;
}

const gzipAsync = promisify(gzip);
const MIN_COMPRESS_BYTES = 1024;

function acceptsGzip(acceptEncoding: string | null): boolean {
  let wildcard = false;
  for (const part of (acceptEncoding ?? '').split(',')) {
    const [coding, ...params] = part.split(';').map((value) => value.trim().toLowerCase());
    const q = params.find((param) => param.startsWith('q='));
    const accepted = q === undefined || Number(q.slice(2)) > 0;
    if (coding === 'gzip' || coding === 'x-gzip') return accepted;
    if (coding === '*') wildcard = accepted;
  }
  return wildcard;
}

// Next's own compression never reaches route handlers (it copies their headers
// with appendHeader, so its filter sees Content-Type as an array and skips it),
// leaving library JSON uncompressed for a client that reaches Helprr directly.
async function withJsonCompression(response: Response, request: Request | null): Promise<Response> {
  const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (
    !request
    || request.method === 'HEAD'
    || !response.body
    || type !== 'application/json'
    || response.headers.has('Content-Encoding')
  ) return response;

  const vary = response.headers.get('Vary');
  if (!vary) response.headers.set('Vary', 'Accept-Encoding');
  else if (!/(^|,)\s*(accept-encoding|\*)\s*(,|$)/i.test(vary)) response.headers.set('Vary', `${vary}, Accept-Encoding`);
  if (!acceptsGzip(request.headers.get('Accept-Encoding'))) return response;

  const init = { status: response.status, statusText: response.statusText, headers: response.headers };
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength < MIN_COMPRESS_BYTES) return new Response(body, init);

  response.headers.set('Content-Encoding', 'gzip');
  response.headers.delete('Content-Length');
  // A strong validator names exact bytes; every If-None-Match check here
  // compares weakly, so the gzipped body still revalidates to a 304.
  const etag = response.headers.get('ETag');
  if (etag && !etag.startsWith('W/')) response.headers.set('ETag', `W/${etag}`);
  return new Response(new Uint8Array(await gzipAsync(body)), init);
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
    const requestClone = (
      prefs.enabled
      && allowBodies
      && prefs.failedRequestBodies
      && request
      && requestMayHaveBody(request)
    ) ? request.clone() : null;
    const startedAt = performance.now();
    const requestId = crypto.randomUUID();
    const meta = requestMetadata(request, options.redactQueryParams);

    try {
      const response = await runWithRequestContext(
        { requestId, startedAt: new Date() },
        () => withPerformanceScope(() => handler(...args)),
      );
      if (!prefs.enabled) {
        response.headers.set('x-request-id', requestId);
        return await withJsonCompression(withDefaultCacheControl(response, request), request);
      }
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
      return await withJsonCompression(withDefaultCacheControl(response, request), request);
    } catch (error) {
      const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
      if (prefs.enabled) {
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
      }
      return NextResponse.json(
        { error: 'Internal server error', requestId },
        { status: 500, headers: { 'x-request-id': requestId, 'Cache-Control': DEFAULT_CACHE_CONTROL } }
      );
    }
  }) as T;
}
