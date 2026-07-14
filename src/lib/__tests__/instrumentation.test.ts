import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const events: string[] = [];
  const event = (name: string) => vi.fn(() => void events.push(name));
  return {
    events,
    setDefaultAutoSelectFamily: event('net'),
    setDefaultResultOrder: event('dns'),
    validateRuntimeConfigOrExit: event('validate'),
    initializeServerLogging: event('logging'),
    configureLogger: event('configure-logger'),
    getJwtSecret: event('jwt'),
    registerShutdownHandlers: event('shutdown-handlers'),
    ensureBootstrapAdmin: vi.fn(async () => void events.push('bootstrap')),
    pollingStart: event('polling'),
    configureApiLogging: event('configure-api-logging'),
    setAppTimeZone: event('timezone'),
    initVapid: event('vapid'),
    seedInitialLayouts: vi.fn(async () => void events.push('layouts')),
    startCleanupJobs: vi.fn(async () => void events.push('cleanup')),
  };
});

vi.mock('net', () => ({
  setDefaultAutoSelectFamily: mocks.setDefaultAutoSelectFamily,
}));
vi.mock('dns', () => ({
  setDefaultResultOrder: mocks.setDefaultResultOrder,
}));
vi.mock('@/lib/startup-config', () => ({
  validateRuntimeConfigOrExit: mocks.validateRuntimeConfigOrExit,
}));
vi.mock('@/lib/logger', () => ({
  initializeServerLogging: mocks.initializeServerLogging,
  configureLogger: mocks.configureLogger,
}));
vi.mock('@/lib/jwt-secret', () => ({ getJwtSecret: mocks.getJwtSecret }));
vi.mock('@/lib/shutdown', () => ({ registerShutdownHandlers: mocks.registerShutdownHandlers }));
vi.mock('@/lib/bootstrap-admin', () => ({ ensureBootstrapAdmin: mocks.ensureBootstrapAdmin }));
vi.mock('@/lib/polling-service', () => ({
  pollingService: { start: mocks.pollingStart },
}));
vi.mock('@/lib/app-settings', () => ({
  getOrCreateAppSettings: vi.fn(async () => ({
    pollingIntervalSecs: 30,
    timeZone: 'UTC',
    logLevel: 'info',
    logMaxFileMb: 50,
    logRetentionDays: 30,
    logEnabled: true,
    logFailedRequestBodies: false,
    logFailedResponseBodies: false,
  })),
}));
vi.mock('@/lib/api-logger', () => ({ configureApiLogging: mocks.configureApiLogging }));
vi.mock('@/lib/timezone', () => ({ setAppTimeZone: mocks.setAppTimeZone }));
vi.mock('@/lib/notification-service', () => ({ initVapid: mocks.initVapid }));
vi.mock('@/lib/dashboard-layouts', () => ({ seedInitialLayouts: mocks.seedInitialLayouts }));
vi.mock('@/lib/cleanup/scheduler', () => ({ startCleanupJobs: mocks.startCleanupJobs }));

import { register } from '@/instrumentation';

const originalRuntime = process.env.NEXT_RUNTIME;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events.length = 0;
  process.env.NEXT_RUNTIME = 'nodejs';
});

afterAll(() => {
  if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = originalRuntime;
});

describe('server startup ordering', () => {
  it('does not initialize any background service after configuration validation fails', async () => {
    mocks.validateRuntimeConfigOrExit.mockImplementationOnce(() => {
      throw new Error('redacted invalid startup configuration');
    });

    await expect(register()).rejects.toThrow('redacted invalid startup configuration');
    expect(mocks.initializeServerLogging).not.toHaveBeenCalled();
    expect(mocks.ensureBootstrapAdmin).not.toHaveBeenCalled();
    expect(mocks.initVapid).not.toHaveBeenCalled();
    expect(mocks.pollingStart).not.toHaveBeenCalled();
    expect(mocks.startCleanupJobs).not.toHaveBeenCalled();
  });

  it('validates before logging, bootstrap, polling, push, and cleanup startup', async () => {
    await register();

    for (const later of ['logging', 'bootstrap', 'vapid', 'polling', 'cleanup']) {
      expect(mocks.events.indexOf('validate')).toBeLessThan(mocks.events.indexOf(later));
    }
    expect(mocks.pollingStart).toHaveBeenCalledWith(30_000);
    expect(mocks.startCleanupJobs).toHaveBeenCalledOnce();
  });
});
