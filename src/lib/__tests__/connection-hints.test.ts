import { describe, expect, it } from 'vitest';
import { connectionFailure, type HintContext } from '@/lib/connection-hints';
import { withDefaultScheme } from '@/lib/service-url';

// The message alone; docs-links.test.ts checks the sections.
const hint = (...args: Parameters<typeof connectionFailure>) => connectionFailure(...args)?.message ?? null;

const docker: HintContext = { inDocker: true, hostGatewayResolves: false };
const dockerWithGateway: HintContext = { inDocker: true, hostGatewayResolves: true };
const native: HintContext = { inDocker: false, hostGatewayResolves: false };
const fail = (code: string) => Object.assign(new Error(`connect ${code} 10.0.0.9:8989`), { code });

// The eight cases from the 2026-11-04 fresh-install trial each get their own cause.
describe('connectionFailure', () => {
  it('explains localhost inside Docker', () => {
    const message = hint(fail('ECONNREFUSED'), 'http://localhost:8989', docker);
    expect(message).toBe("In Docker, localhost usually means Helprr's own container, so nothing answers there. Use your server's IP address.");
  });

  it('suggests host.docker.internal only when it resolves', () => {
    expect(hint(fail('ECONNREFUSED'), 'http://127.0.0.1:8989', dockerWithGateway))
      .toContain('http://host.docker.internal');
    expect(hint(fail('ECONNREFUSED'), 'http://127.0.0.1:8989', docker))
      .not.toContain('host.docker.internal');
  });

  it.each(['http://[::1]:8989', 'http://0.0.0.0:8989', 'http://127.0.0.2:8989', 'http://sonarr.localhost:8989'])('treats %s as localhost', (url) => {
    expect(hint(fail('ECONNREFUSED'), url, docker)).toMatch(/^In Docker, localhost/);
  });

  it('gives the plain refusal outside Docker', () => {
    expect(hint(fail('ECONNREFUSED'), 'http://localhost:8989', native))
      .toBe('Nothing is answering at that address and port. Check the port, and that the app is running.');
  });

  it('names an unknown container name', () => {
    expect(hint(fail('ENOTFOUND'), 'http://sonarr:8989', docker)).toMatch(/can't find that name from inside its container/);
    expect(hint(fail('EAI_AGAIN'), 'http://sonarr:8989', native)).toMatch(/^Helprr can't find that name\./);
  });

  it('names a wrong port on a real host', () => {
    expect(hint(fail('ECONNREFUSED'), 'http://192.168.1.10:8999', docker)).toMatch(/^Nothing is answering/);
  });

  it.each(['ECONNABORTED', 'ETIMEDOUT'])('names a timeout (%s)', (code) => {
    expect(hint(fail(code), 'http://10.0.0.9:8989', docker)).toMatch(/^No answer in time/);
  });

  it.each(['EHOSTUNREACH', 'ENETUNREACH'])('names an unreachable network (%s)', (code) => {
    expect(hint(fail(code), 'http://10.0.0.9:8989', docker)).toMatch(/can't reach that address/);
  });

  it.each(['EPROTO', 'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_PACKET_LENGTH_TOO_LONG'])('tells https:// to a plain HTTP port to use http:// (%s)', (code) => {
    expect(hint(fail(code), 'https://10.0.0.9:8989', docker)).toBe('That port speaks plain HTTP. Start the address with http:// instead.');
  });

  it('tells a reset http:// connection it may need https://', () => {
    expect(hint(fail('ECONNRESET'), 'http://10.0.0.9:8920', docker)).toMatch(/If the app uses HTTPS, start the address with https:\/\//);
  });

  it('tells a reset https:// connection to check the port', () => {
    expect(hint(fail('ECONNRESET'), 'https://10.0.0.9:8989', docker)).toMatch(/Check the port, and try http:\/\//);
  });

  it.each(['DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'])('names a refused certificate (%s)', (code) => {
    expect(hint(fail(code), 'https://sonarr.home', docker)).toMatch(/certificate was refused/);
  });

  it('reads the code from the cause too', () => {
    const error = Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    expect(hint(error, 'http://nope:8989', native)).toMatch(/can't find that name/);
  });

  it('names a 404 as the wrong base path', () => {
    const error = Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } });
    expect(hint(error, 'http://10.0.0.9:8989/sonarr', docker)).toMatch(/^Something answered, but not the API/);
  });

  it('names an address that is not a URL', () => {
    expect(hint(new Error('Invalid URL'), 'http://', native)).toMatch(/^That is not a valid address/);
  });

  it('says nothing more for an unknown error', () => {
    expect(hint(new Error('boom'), 'http://10.0.0.9:8989', docker)).toBeNull();
  });
});

describe('withDefaultScheme', () => {
  it.each([
    ['192.168.1.10:8990', 'http://192.168.1.10:8990'],
    ['  sonarr.lan:8989 ', 'http://sonarr.lan:8989'],
    ['localhost:8989', 'http://localhost:8989'],
    ['http://sonarr.lan:8989', 'http://sonarr.lan:8989'],
    ['HTTPS://sonarr.lan', 'HTTPS://sonarr.lan'],
    ['', ''],
  ])('reads %j as %j', (input, expected) => {
    expect(withDefaultScheme(input)).toBe(expected);
  });
});
