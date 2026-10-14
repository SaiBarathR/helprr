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
