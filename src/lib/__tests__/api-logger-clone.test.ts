import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: mocks,
  redact: (value: unknown) => value,
}));

import { configureApiLogging, withApiLogging } from '@/lib/api-logger';

beforeEach(() => {
  vi.clearAllMocks();
  configureApiLogging({
    enabled: true,
    failedRequestBodies: false,
    failedResponseBodies: false,
  });
});

afterEach(() => {
  configureApiLogging({
    enabled: true,
    failedRequestBodies: false,
    failedResponseBodies: false,
  });
});

function request(): Request {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    body: '{"password":"secret"}',
    headers: { 'content-type': 'application/json' },
  });
}

describe('API request logging clones', () => {
  it('does not clone when API logging is disabled', async () => {
    configureApiLogging({ enabled: false, failedRequestBodies: true });
    const input = request();
    const clone = vi.spyOn(input, 'clone');
    const handler = withApiLogging(
      async (handlerRequest: Request) => {
        void handlerRequest;
        return new Response(null, { status: 400 });
      },
    );

    await handler(input as never);

    expect(clone).not.toHaveBeenCalled();
  });

  it('does not clone secret routes even when failed-body logging is enabled', async () => {
    configureApiLogging({ failedRequestBodies: true });
    const input = request();
    const clone = vi.spyOn(input, 'clone');
    const handler = withApiLogging(
      async (handlerRequest: Request) => {
        void handlerRequest;
        return new Response(null, { status: 400 });
      },
      'api/auth/test',
      { logBodies: false },
    );

    await handler(input as never);

    expect(clone).not.toHaveBeenCalled();
  });

  it('does not clone ordinary routes when failed-body logging is disabled', async () => {
    const input = request();
    const clone = vi.spyOn(input, 'clone');
    const handler = withApiLogging(
      async (handlerRequest: Request) => {
        void handlerRequest;
        return new Response(null, { status: 400 });
      },
    );

    await handler(input as never);

    expect(clone).not.toHaveBeenCalled();
  });

  it('does not clone methods that cannot have a request body', async () => {
    configureApiLogging({ failedRequestBodies: true });
    const input = new Request('http://localhost/api/test');
    const clone = vi.spyOn(input, 'clone');
    const handler = withApiLogging(
      async (handlerRequest: Request) => {
        void handlerRequest;
        return new Response(null, { status: 400 });
      },
    );

    await handler(input as never);

    expect(clone).not.toHaveBeenCalled();
  });

  it('clones once and logs a bounded preview only when every gate is enabled', async () => {
    configureApiLogging({ failedRequestBodies: true });
    const input = request();
    const clone = vi.spyOn(input, 'clone');
    const handler = withApiLogging(
      async (handlerRequest: Request) => {
        void handlerRequest;
        return new Response(null, { status: 400 });
      },
    );

    await handler(input as never);

    expect(clone).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledOnce();
  });

  it('redacts nested image source URLs from request metadata', async () => {
    const source = 'https://images.example.com/poster.jpg?token=secret#fragment';
    const input = new Request(
      `http://localhost/api/image?src=${encodeURIComponent(source)}&w=300`,
    );
    const handler = withApiLogging(
      async (loggedRequest: Request) => {
        void loggedRequest;
        return new Response(null, { status: 200 });
      },
      'api/image',
      { redactQueryParams: ['src'] },
    );

    await handler(input as never);

    expect(mocks.info).toHaveBeenCalledOnce();
    const metadata = mocks.info.mock.calls[0]?.[1] as { path?: string };
    expect(metadata.path).toContain('src=%5Bredacted%5D');
    expect(metadata.path).not.toContain('images.example.com');
    expect(metadata.path).not.toContain('secret');
    expect(metadata.path).not.toContain('fragment');
  });
});
