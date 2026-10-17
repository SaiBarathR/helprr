import { describe, expect, it } from 'vitest';
import { connectionFormErrors, type ConnectionForm, type HeaderRow } from './connection-form';

function form(overrides: Partial<ConnectionForm> = {}): ConnectionForm {
  return {
    url: 'http://sonarr:8989',
    apiKey: 'key',
    isQbt: false,
    savedKeyKept: false,
    isMultiInstance: false,
    label: '',
    isJellyfin: false,
    jellyfinValidated: false,
    username: undefined,
    canEditHeaders: false,
    headers: [],
    urlChanged: false,
    isSavedHeaderValue: () => false,
    ...overrides,
  };
}
const header = (name: string, value: string, id = 'h1'): HeaderRow => ({ id, name, value });
const headerErrors = (headers: HeaderRow[], extra: Partial<ConnectionForm> = {}) =>
  connectionFormErrors(form({ canEditHeaders: true, headers, ...extra }), false).headers;

describe('connectionFormErrors', () => {
  it('passes a complete form', () => {
    expect(connectionFormErrors(form(), true)).toEqual({ fields: {}, headers: {} });
  });

  it('requires a URL and an API key, or a password for qBittorrent', () => {
    expect(connectionFormErrors(form({ url: ' ', apiKey: '' }), false).fields)
      .toEqual({ url: 'URL is required', apiKey: 'API key is required' });
    expect(connectionFormErrors(form({ isQbt: true, apiKey: '  ' }), false).fields)
      .toEqual({ apiKey: 'Password is required' });
  });

  it('asks for the secret again when the URL changed under a saved one', () => {
    expect(connectionFormErrors(form({ savedKeyKept: true }), false).fields)
      .toEqual({ apiKey: 'Enter the API key again for the new URL' });
    expect(connectionFormErrors(form({ isQbt: true, savedKeyKept: true }), false).fields)
      .toEqual({ apiKey: 'Enter the password again for the new URL' });
  });

  it('needs a name for a multi-instance service, on Save only', () => {
    const unnamed = form({ isMultiInstance: true, label: '  ' });
    expect(connectionFormErrors(unnamed, false).fields).toEqual({});
    expect(connectionFormErrors(unnamed, true).fields).toEqual({ label: 'Name this instance' });
    expect(connectionFormErrors(form({ isMultiInstance: true, label: 'Anime' }), true).fields).toEqual({});
  });

  it('needs a Jellyfin user once the server is validated, on Save only', () => {
    const noUser = form({ isJellyfin: true, jellyfinValidated: true, username: ' ' });
    expect(connectionFormErrors(noUser, false).fields).toEqual({});
    expect(connectionFormErrors(noUser, true).fields).toEqual({ jellyfinUser: 'Select a Jellyfin user' });
    expect(connectionFormErrors(form({ isJellyfin: true, jellyfinValidated: false }), true).fields).toEqual({});
  });

  describe('custom headers', () => {
    it('checks them only where headers can be edited, and skips blank rows', () => {
      expect(connectionFormErrors(form({ headers: [header('bad name', '')] }), false).headers).toEqual({});
      expect(headerErrors([header('  ', 'anything')])).toEqual({});
    });

    it('limits names to letters, numbers and hyphens, and refuses Host', () => {
      expect(headerErrors([header('X_Token', 'v')])).toEqual({ h1: { name: 'Letters, numbers, and hyphens only' } });
      expect(headerErrors([header('HOST', 'v')])).toEqual({ h1: { name: 'Host cannot be set here' } });
      expect(headerErrors([header('X-Token', 'v')])).toEqual({});
    });

    it('needs a value of at most 2048 characters with no control characters', () => {
      expect(headerErrors([header('X-Token', '  ')])).toEqual({ h1: { value: 'Value required' } });
      expect(headerErrors([header('X-Token', 'a'.repeat(2048))])).toEqual({});
      expect(headerErrors([header('X-Token', 'a'.repeat(2049))])).toEqual({ h1: { value: 'Too long (max 2048 characters)' } });
      for (const value of ['a\nb', 'a\u0000b', 'a\u007fb', 'a\tb']) {
        expect(headerErrors([header('X-Token', value)]), JSON.stringify(value)).toEqual({ h1: { value: 'Contains invalid characters' } });
      }
    });

    it('asks for a saved value again after the URL changed', () => {
      const saved = header('X-Token', 'secret');
      expect(headerErrors([saved], { urlChanged: true, isSavedHeaderValue: (row) => row === saved }))
        .toEqual({ h1: { value: 'Enter this value again for the new URL' } });
      expect(headerErrors([saved], { urlChanged: false, isSavedHeaderValue: (row) => row === saved })).toEqual({});
    });

    it('reports each row on its own', () => {
      expect(headerErrors([header('X-A', 'ok', 'a'), header('X B', 'v', 'b'), header('X-C', '', 'c')])).toEqual({
        b: { name: 'Letters, numbers, and hyphens only' },
        c: { value: 'Value required' },
      });
    });
  });
});
