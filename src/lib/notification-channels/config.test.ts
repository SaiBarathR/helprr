import { beforeAll, describe, expect, it } from 'vitest';
import type { NotificationChannel } from '@prisma/client';
import {
  decryptSecrets,
  encryptSecrets,
  REENTER_CHANNEL_SECRET_MESSAGE,
  serializeChannel,
  validateChannelInput,
} from './config';

const ADMIN = { allowPrivate: true };

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-tests';
});

describe('validateChannelInput', () => {
  it('fills defaults and splits secret fields from config', () => {
    const result = validateChannelInput('ntfy', {}, { topic: 'helprr-abc' }, ADMIN);
    expect(result).toEqual({ ok: true, config: { serverUrl: 'https://ntfy.sh', priority: '3' }, secrets: { topic: 'helprr-abc' } });
  });

  it('keeps the Apprise key with the secrets, never in the exported config', () => {
    const typed = validateChannelInput('apprise', { apiUrl: 'https://apprise.example.com' }, { key: 'family' }, ADMIN);
    expect(typed).toEqual({ ok: true, config: { apiUrl: 'https://apprise.example.com' }, secrets: { key: 'family' } });
    // Left empty on a new channel, it is the usual "apprise".
    const blank = validateChannelInput('apprise', { apiUrl: 'https://apprise.example.com' }, {}, ADMIN);
    expect(blank).toMatchObject({ ok: true, secrets: { key: 'apprise' } });
    expect(validateChannelInput('apprise', { apiUrl: 'https://apprise.example.com' }, { key: 'no spaces' }, ADMIN)).toMatchObject({ ok: false });
  });

  it('moves an Apprise key saved in the config (edge builds) into the secrets on the next save', () => {
    const existing = { config: { apiUrl: 'https://apprise.example.com', key: 'family' }, secrets: {} };
    const saved = validateChannelInput('apprise', { apiUrl: 'https://apprise.example.com', tags: 'tv' }, {}, { ...ADMIN, existing });
    expect(saved).toEqual({ ok: true, config: { apiUrl: 'https://apprise.example.com', tags: 'tv' }, secrets: { key: 'family' } });
    // Sending it somewhere else needs it typed again, as any kept secret does.
    expect(validateChannelInput('apprise', { apiUrl: 'https://other.example.com' }, {}, { ...ADMIN, existing }))
      .toEqual({ ok: false, error: REENTER_CHANNEL_SECRET_MESSAGE });
  });

  it('refuses a channel address that points at cloud metadata', () => {
    expect(validateChannelInput('webhook', {}, { url: 'http://169.254.169.254/latest/meta-data' }, ADMIN)).toMatchObject({ ok: false });
    expect(validateChannelInput('gotify', { serverUrl: 'http://metadata.google.internal' }, { appToken: 'x' }, ADMIN)).toMatchObject({ ok: false });
    expect(validateChannelInput('email', { host: '169.254.169.254', from: 'a@b.co', to: 'c@d.co' }, {}, ADMIN)).toMatchObject({ ok: false });
  });

  it('keeps a member to public addresses and server URLs to a bare address', () => {
    const member = { allowPrivate: false };
    expect(validateChannelInput('webhook', {}, { url: 'http://192.168.1.10:8123/api/webhook/x' }, member)).toMatchObject({ ok: false });
    expect(validateChannelInput('webhook', {}, { url: 'http://192.168.1.10:8123/api/webhook/x' }, ADMIN)).toMatchObject({ ok: true });
    expect(validateChannelInput('email', { host: 'localhost', from: 'a@b.co', to: 'c@d.co' }, {}, member)).toMatchObject({ ok: false });
    expect(validateChannelInput('ntfy', { serverUrl: 'https://ntfy.sh/?auth=tk' }, { topic: 't' }, ADMIN)).toMatchObject({ ok: false });
    expect(validateChannelInput('gotify', { serverUrl: 'https://g.example/#x' }, { appToken: 't' }, ADMIN)).toMatchObject({ ok: false });
    expect(validateChannelInput('webhook', {}, { url: 'https://hook.example/h?key=1' }, member)).toMatchObject({ ok: true });
  });

  it('requires the required fields and checks their shape', () => {
    expect(validateChannelInput('ntfy', {}, {}, ADMIN)).toMatchObject({ ok: false, error: 'Topic is required.' });
    expect(validateChannelInput('ntfy', {}, { topic: 'has space' }, ADMIN)).toMatchObject({ ok: false });
    expect(validateChannelInput('email', { host: 'smtp.example.com', from: 'nope', to: 'c@d.co' }, {}, ADMIN)).toMatchObject({ ok: false });
    expect(validateChannelInput('email', { host: 'smtp.example.com', port: '99999', from: 'a@b.co', to: 'c@d.co' }, {}, ADMIN)).toMatchObject({ ok: false });
    expect(validateChannelInput('email', { host: 'smtp.example.com', security: 'none', from: 'a@b.co', to: 'c@d.co' }, {}, ADMIN)).toMatchObject({ ok: false });
    expect(validateChannelInput('webhook', { headerName: 'Host' }, { url: 'https://x.example/h', headerValue: 'v' }, ADMIN)).toMatchObject({ ok: false });
  });

  it('keeps a saved secret when the field is left empty, and clears it on null', () => {
    const existing = { config: { serverUrl: 'https://ntfy.sh', priority: '3' }, secrets: { topic: 'old', token: 'tk' } };
    expect(validateChannelInput('ntfy', existing.config, {}, { allowPrivate: true, existing })).toEqual({ ok: true, config: existing.config, secrets: existing.secrets });
    expect(validateChannelInput('ntfy', existing.config, { token: null }, { allowPrivate: true, existing })).toEqual({ ok: true, config: existing.config, secrets: { topic: 'old' } });
    expect(validateChannelInput('ntfy', existing.config, { topic: null }, { allowPrivate: true, existing })).toMatchObject({ ok: false });
  });

  it('asks for the secrets again before sending them to a different address', () => {
    const existing = { config: { serverUrl: 'https://ntfy.sh', priority: '3' }, secrets: { topic: 'old', token: 'tk' } };
    const moved = { ...existing.config, serverUrl: 'https://attacker.example' };
    expect(validateChannelInput('ntfy', moved, {}, { allowPrivate: true, existing })).toEqual({ ok: false, error: REENTER_CHANNEL_SECRET_MESSAGE });
    expect(validateChannelInput('ntfy', moved, { topic: 'new', token: 'tk2' }, { allowPrivate: true, existing })).toMatchObject({ ok: true });

    const hook = { config: { headerName: 'X-Helprr-Secret' }, secrets: { url: 'https://a.example/h', headerValue: 'shh' } };
    expect(validateChannelInput('webhook', hook.config, { url: 'https://b.example/h' }, { allowPrivate: true, existing: hook })).toEqual({ ok: false, error: REENTER_CHANNEL_SECRET_MESSAGE });
  });
});

describe('secret storage', () => {
  it('encrypts with enc:v1 and decrypts back', () => {
    const stored = encryptSecrets({ token: 'tk_secret' });
    expect(stored).toMatch(/^enc:v1:/);
    expect(stored).not.toContain('tk_secret');
    expect(decryptSecrets(stored)).toEqual({ token: 'tk_secret' });
    expect(encryptSecrets({})).toBeNull();
  });

  it('treats a blob from another server secret as unreadable', () => {
    const stored = encryptSecrets({ token: 'tk' });
    process.env.JWT_SECRET = 'a-different-secret-after-rotation-xxxxxxxx';
    try {
      expect(decryptSecrets(stored)).toBeNull();
    } finally {
      process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-tests';
    }
  });

  it('never serializes a secret, only which ones are set', () => {
    const row = {
      id: 'c1', userId: 'u1', type: 'webhook', name: 'HA', enabled: true, events: ['imported'],
      config: { headerName: 'X-Helprr-Secret' },
      secrets: encryptSecrets({ url: 'http://ha.local:8123/api/webhook/SECRET-ID', headerValue: 'shh' }),
      consecutiveFailures: 0, lastFailedAt: null, lastSucceededAt: null, lastError: null,
      createdAt: new Date('2026-11-07T00:00:00Z'), updatedAt: new Date('2026-11-07T00:00:00Z'),
    } as NotificationChannel;
    const summary = serializeChannel(row);
    expect(summary.secretsSet.sort()).toEqual(['headerValue', 'url']);
    expect(summary.destination).toBe('ha.local:8123');
    const json = JSON.stringify(summary);
    expect(json).not.toContain('SECRET-ID');
    expect(json).not.toContain('shh');
    expect(json).not.toContain('enc:v1');
  });
});
