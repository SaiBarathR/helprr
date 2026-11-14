import axios from 'axios';
import { isIP } from 'node:net';
import { createTransport } from 'nodemailer';
import {
  checkOutboundUrl,
  createGuardedLookup,
  isBlockedHostname,
  OutboundAddressError,
  resolveOutboundHost,
  type OutboundRules,
} from '@/lib/outbound-url';
import { isRefusedRedirect, refuseRedirectToAnotherHost } from '@/lib/redirect-guard';
import type { ChannelType } from './catalog';
import type { FieldMap } from './config';

/** One notification as every channel receives it. */
export interface ChannelMessage {
  eventType: string;
  title: string;
  body: string;
  /** An absolute link into Helprr, when APP_ORIGIN is set. */
  link: string | null;
  /** The in-app path the notification opens. */
  path: string | null;
  metadata: Record<string, unknown>;
  sentAt: string;
}

/** A send that failed. `reason` is a short fixed phrase, safe to store and show: never a secret or a response body. */
export class ChannelSendError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export const SEND_TIMEOUT_MS = 10_000;
const MAX_TITLE = 250;
const MAX_BODY = 4000;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function hasCause(error: unknown, type: new (...args: never[]) => Error): boolean {
  for (let cause = error, depth = 0; cause && depth < 5; depth += 1) {
    if (cause instanceof type) return true;
    cause = (cause as { cause?: unknown }).cause;
  }
  return false;
}

function failureReason(error: unknown): string {
  if (error instanceof ChannelSendError) return error.reason;
  if (hasCause(error, OutboundAddressError)) return 'Address not allowed';
  if (isRefusedRedirect(error)) return 'Redirects to another address';
  const err = error as { response?: { status?: number }; responseCode?: number; code?: string; name?: string };
  if (typeof err?.response?.status === 'number') return `HTTP ${err.response.status}`;
  if (typeof err?.responseCode === 'number') return `SMTP ${err.responseCode}`;
  const code = typeof err?.code === 'string' ? err.code : '';
  if (code === 'EAUTH') return 'Sign-in refused';
  if (code === 'ETLS' || /CERT|SSL|TLS/i.test(code)) return 'TLS failed';
  if (code === 'EENVELOPE') return 'Address refused';
  if (['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED', 'ESOCKETTIMEDOUT'].includes(code) || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
    return 'Timed out';
  }
  if (code === 'ECONNREFUSED') return 'Connection refused';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Server name not found';
  return 'Could not connect';
}

/**
 * POST JSON to a user's address: checked again here (a row saved before a rule
 * existed cannot slip through), every resolved address checked at connect time,
 * no redirect to another host, no proxy, a hard deadline, and a small response cap.
 */
async function postJson(rules: OutboundRules, url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  const checked = checkOutboundUrl(url, rules);
  if (!checked.ok) throw new ChannelSendError('Address not allowed');
  try {
    await axios.post(checked.url.toString(), body, {
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Helprr', ...headers },
      timeout: SEND_TIMEOUT_MS,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      lookup: (rules.allowPrivate ? adminLookup : memberLookup) as never,
      beforeRedirect: refuseRedirectToAnotherHost,
      maxRedirects: 3,
      maxContentLength: 64 * 1024,
      maxBodyLength: 256 * 1024,
      responseType: 'text',
      proxy: false,
      validateStatus: (status) => status >= 200 && status < 300,
    });
  } catch (error) {
    throw new ChannelSendError(failureReason(error));
  }
}

const adminLookup = createGuardedLookup({ allowPrivate: true });
const memberLookup = createGuardedLookup({ allowPrivate: false });

function base(url: string | undefined): string {
  return (url ?? '').replace(/\/+$/, '');
}

async function sendNtfy(rules: OutboundRules, config: FieldMap, secrets: FieldMap, message: ChannelMessage): Promise<void> {
  const headers: Record<string, string> = {};
  if (secrets.token) headers.Authorization = `Bearer ${secrets.token}`;
  else if (config.username && secrets.password) {
    headers.Authorization = `Basic ${Buffer.from(`${config.username}:${secrets.password}`).toString('base64')}`;
  }
  // ntfy takes a JSON message posted to the server's root.
  await postJson(rules, `${base(config.serverUrl)}/`, {
    topic: secrets.topic,
    title: clip(message.title, MAX_TITLE),
    message: clip(message.body, MAX_BODY),
    priority: Number(config.priority ?? 3),
    ...(message.link ? { click: message.link } : {}),
  }, headers);
}

async function sendGotify(rules: OutboundRules, config: FieldMap, secrets: FieldMap, message: ChannelMessage): Promise<void> {
  await postJson(rules, `${base(config.serverUrl)}/message`, {
    title: clip(message.title, MAX_TITLE),
    message: clip(message.body, MAX_BODY),
    priority: Number(config.priority ?? 5),
    ...(message.link ? { extras: { 'client::notification': { click: { url: message.link } } } } : {}),
  }, { 'X-Gotify-Key': secrets.appToken ?? '' });
}

async function sendWebhook(rules: OutboundRules, config: FieldMap, secrets: FieldMap, message: ChannelMessage): Promise<void> {
  const headers: Record<string, string> = {};
  if (config.headerName && secrets.headerValue) headers[config.headerName] = secrets.headerValue;
  await postJson(rules, secrets.url ?? '', {
    source: 'helprr',
    event: message.eventType,
    title: message.title,
    body: message.body,
    url: message.link,
    path: message.path,
    metadata: message.metadata,
    sentAt: message.sentAt,
  }, headers);
}

async function sendApprise(rules: OutboundRules, config: FieldMap, secrets: FieldMap, message: ChannelMessage): Promise<void> {
  const tags = (config.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean);
  // The key is a secret; a channel saved before it was one still has it in its config.
  const key = secrets.key ?? config.key ?? 'apprise';
  await postJson(rules, `${base(config.apiUrl)}/notify/${encodeURIComponent(key)}`, {
    title: clip(message.title, MAX_TITLE),
    body: clip(message.link ? `${message.body}\n\n${message.link}` : message.body, MAX_BODY),
    type: 'info',
    ...(tags.length > 0 ? { tag: tags.join(',') } : {}),
  });
}

async function sendEmail(rules: OutboundRules, config: FieldMap, secrets: FieldMap, message: ChannelMessage): Promise<void> {
  const host = config.host ?? '';
  if (isBlockedHostname(host, rules)) throw new ChannelSendError('Address not allowed');
  let transport: ReturnType<typeof createTransport> | null = null;
  try {
    // Resolved once through the guard and connected to by address; the name
    // stays the TLS server name, so the certificate is still checked against it.
    const address = await resolveOutboundHost(host, rules);
    transport = createTransport({
      host: address,
      port: Number(config.port),
      secure: config.security === 'tls',
      // STARTTLS is required, never optional: no plain-text fallback.
      requireTLS: config.security !== 'tls',
      servername: isIP(host) ? undefined : host,
      tls: { minVersion: 'TLSv1.2' },
      auth: config.username && secrets.password ? { user: config.username, pass: secrets.password } : undefined,
      connectionTimeout: SEND_TIMEOUT_MS,
      greetingTimeout: SEND_TIMEOUT_MS,
      socketTimeout: SEND_TIMEOUT_MS,
      logger: false,
      debug: false,
    });
    const text = message.link ? `${message.body}\n\n${message.link}` : message.body;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      transport.sendMail({ from: config.from, to: config.to, subject: clip(message.title, MAX_TITLE), text: clip(text, MAX_BODY) }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new ChannelSendError('Timed out')), SEND_TIMEOUT_MS * 2);
      }),
    ]).finally(() => clearTimeout(timer));
  } catch (error) {
    throw new ChannelSendError(failureReason(error));
  } finally {
    transport?.close();
  }
}

const SENDERS: Record<ChannelType, (rules: OutboundRules, config: FieldMap, secrets: FieldMap, message: ChannelMessage) => Promise<void>> = {
  ntfy: sendNtfy,
  gotify: sendGotify,
  webhook: sendWebhook,
  apprise: sendApprise,
  email: sendEmail,
};

/**
 * Send one message. `rules` is the owner's reach: LAN addresses only for an
 * admin's channel. Throws ChannelSendError with a short, secret-free reason.
 */
export async function sendToChannel(
  type: ChannelType,
  config: FieldMap,
  secrets: FieldMap,
  message: ChannelMessage,
  rules: OutboundRules,
): Promise<void> {
  await SENDERS[type](rules, config, secrets, message);
}
