import { AsyncLocalStorage } from 'node:async_hooks';

// The API request a piece of server work belongs to. withApiLogging opens it, so
// an operation-audit row written while handling the request can be tied to the
// x-request-id its log entry and response carry. Work outside a request (the
// cleanup scheduler, polling) has no context.
export interface RequestContext {
  requestId: string;
  startedAt: Date;
}

// Shared across webpack bundles via globalThis — see note in logger.ts.
const STORAGE_KEY = '__helprrRequestContext' as const;
const globalScope = globalThis as typeof globalThis & {
  [STORAGE_KEY]?: AsyncLocalStorage<RequestContext>;
};
const storage = globalScope[STORAGE_KEY] ?? new AsyncLocalStorage<RequestContext>();
globalScope[STORAGE_KEY] = storage;

export function runWithRequestContext<T>(context: RequestContext, operation: () => T): T {
  return storage.run(context, operation);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Run code that sets up work outliving the request, such as a timer: anything
 * it creates would otherwise carry this request's context into every later run.
 */
export function runOutsideRequestContext<T>(operation: () => T): T {
  return storage.exit(operation);
}
