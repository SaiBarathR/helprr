// qBittorrent's main log, rebuilt for an admin (QBT-24). Only id, time, level
// and message pass, and the message is redacted: qBittorrent logs the host's
// external IP, the addresses it listens on and the IP of every Web UI login,
// so IP addresses are masked; URLs are cut to their host and credentials and
// magnets removed (as for the arr logs). File paths stay: they are how an admin
// finds the torrent behind an I/O error, and only admins read this.
import { redactLogText } from '@/lib/server/arr-system';
import {
  QBIT_LOG_PAGE_SIZE,
  QBIT_LOG_TYPE_LEVEL,
  type QbitLogEntry,
  type QbitLogPage,
} from '@/lib/qbittorrent-log';

const MESSAGE_MAX = 2_000;
const MASK = '[IP]';
// Say nothing about the host: any address, and loopback.
const KEPT = new Set(['0.0.0.0', '127.0.0.1', '::', '::1']);

const H = '[0-9a-f]{1,4}';
const V4 = '\\d{1,3}(?:\\.\\d{1,3}){3}';
// One with an IPv4 tail (::ffff:1.2.3.4, 0:0:0:0:0:ffff:1.2.3.4) first, or
// the hex groups would stop at its first number; then all eight groups, or a
// "::" shortened one. Not inside a longer word or hex run, so a hash or
// "Session::" is left alone; a colon after it may end a label ("IP: …: …").
const IPV6 = new RegExp(
  `(?<![\\w:.])(?:(?:${H}:){6}${V4}|(?:${H}:){0,6}(?:${H})?::(?:${H}:){0,5}${V4}|(?:${H}:){7}${H}|(?:${H}:){0,7}(?:${H})?::(?:${H}(?::${H}){0,6})?)(?!\\w|:[0-9a-f])`,
  'gi',
);
// Only digits bound it, so one glued to a word (peer_10.0.0.1) goes too. A
// full stop after it may end the sentence; one before a digit makes it a
// longer number (a version like 5.1.4.10 is masked: the safe side).
const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?!\d|\.\d)/g;

function maskIps(text: string): string {
  const mask = (address: string) => (KEPT.has(address.toLowerCase()) ? address : MASK);
  // v6 first, so an IPv4-mapped address goes whole.
  return text.replace(IPV6, mask).replace(IPV4, mask);
}

export function redactQbitLogText(text: unknown): string {
  // Masked before the length cut, so a cut can't leave half an address.
  return redactLogText(maskIps(typeof text === 'string' ? text : ''), '', Number.MAX_SAFE_INTEGER).slice(0, MESSAGE_MAX);
}

function toEntry(raw: Record<string, unknown> | null): QbitLogEntry | null {
  const id = Number(raw?.id);
  const seconds = Number(raw?.timestamp);
  const level = QBIT_LOG_TYPE_LEVEL[Number(raw?.type)];
  if (!Number.isInteger(id) || id < 0 || !Number.isFinite(seconds) || seconds <= 0 || !level) return null;
  return { id, time: new Date(seconds * 1000).toISOString(), level, message: redactQbitLogText(raw?.message) };
}

/**
 * One page, newest first: the newest entries older than `before` (all of
 * them without it). qBittorrent only lists forward from an id, so the route
 * reads what it keeps (20,000 messages at most) and pages here.
 */
export function toQbitLogPage(raw: unknown, before: number | null): QbitLogPage {
  const rows = (Array.isArray(raw) ? raw : [])
    .filter((row: { id?: unknown } | null) => before === null || Number(row?.id) < before)
    .sort((a: { id?: unknown }, b: { id?: unknown }) => Number(b?.id) - Number(a?.id));
  const entries = rows.slice(0, QBIT_LOG_PAGE_SIZE).flatMap((row) => toEntry(row) ?? []);
  const last = rows[QBIT_LOG_PAGE_SIZE - 1] as { id?: unknown } | undefined;
  return {
    entries,
    nextBefore: rows.length > QBIT_LOG_PAGE_SIZE && last ? Number(last.id) : null,
  };
}
