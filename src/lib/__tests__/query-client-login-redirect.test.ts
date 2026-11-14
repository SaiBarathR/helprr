import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const assign = vi.fn();

beforeEach(() => {
  vi.resetModules();
  assign.mockReset();
  vi.stubGlobal('window', { location: { pathname: '/settings/sessions', search: '', hash: '', assign } });
});

afterEach(() => vi.unstubAllGlobals());

describe('login redirect on 401', () => {
  it('sends a dead session to Login with the current location', async () => {
    const { handleAuthError } = await import('@/lib/query-client');
    const { ApiError } = await import('@/lib/query-fetch');
    handleAuthError(new ApiError(401, 'GET /api/sessions → 401'));
    expect(assign).toHaveBeenCalledWith('/login?next=%2Fsettings%2Fsessions');
  });

  it('waits while a sign-out clears this browser', async () => {
    const { handleAuthError, holdLoginRedirect } = await import('@/lib/query-client');
    const { ApiError } = await import('@/lib/query-fetch');
    holdLoginRedirect();
    handleAuthError(new ApiError(401, 'GET /api/sessions → 401'));
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('deferred while a request that may end the session runs', () => {
  it('a 401 meanwhile waits, and goes to Login on release', async () => {
    const { handleAuthError, deferLoginRedirect } = await import('@/lib/query-client');
    const { ApiError } = await import('@/lib/query-fetch');
    const release = deferLoginRedirect();
    handleAuthError(new ApiError(401, 'GET /api/badges → 401'));
    expect(assign).not.toHaveBeenCalled();
    release();
    expect(assign).toHaveBeenCalledExactlyOnceWith('/login?next=%2Fsettings%2Fsessions');
    release();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('release without a 401 meanwhile goes nowhere, and a later 401 redirects as usual', async () => {
    const { handleAuthError, deferLoginRedirect } = await import('@/lib/query-client');
    const { ApiError } = await import('@/lib/query-fetch');
    deferLoginRedirect()();
    expect(assign).not.toHaveBeenCalled();
    handleAuthError(new ApiError(401, 'GET /api/badges → 401'));
    expect(assign).toHaveBeenCalledOnce();
  });

  it('a hold placed before release keeps the waiting 401 from redirecting', async () => {
    const { handleAuthError, deferLoginRedirect, holdLoginRedirect } = await import('@/lib/query-client');
    const { ApiError } = await import('@/lib/query-fetch');
    const release = deferLoginRedirect();
    handleAuthError(new ApiError(401, 'GET /api/badges → 401'));
    holdLoginRedirect();
    release();
    expect(assign).not.toHaveBeenCalled();
  });

  it('waits until the last of two overlapping requests is released', async () => {
    const { handleAuthError, deferLoginRedirect } = await import('@/lib/query-client');
    const { ApiError } = await import('@/lib/query-fetch');
    const first = deferLoginRedirect();
    const second = deferLoginRedirect();
    handleAuthError(new ApiError(401, 'GET /api/badges → 401'));
    first();
    expect(assign).not.toHaveBeenCalled();
    second();
    expect(assign).toHaveBeenCalledOnce();
  });
});
