// Whether this process has begun its graceful shutdown. Kept on globalThis:
// each API route is its own module instance, and the shutdown coordinator runs
// in the instrumentation hook's.
const state = globalThis as typeof globalThis & { shutdownInProgress?: boolean };

export function isShuttingDown(): boolean {
  return state.shutdownInProgress === true;
}

export function markShuttingDown(): void {
  state.shutdownInProgress = true;
}
