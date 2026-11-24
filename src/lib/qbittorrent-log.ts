// QBT-24: qBittorrent's main log as Torrents settings → Log shows it. Shared
// by the route and the page; no server imports.

export const QBIT_LOG_LEVELS = ['normal', 'info', 'warning', 'critical'] as const;
export type QbitLogLevel = (typeof QBIT_LOG_LEVELS)[number];

/** qBittorrent's message types (Log::MsgType). */
export const QBIT_LOG_TYPE_LEVEL: Readonly<Record<number, QbitLogLevel>> = { 1: 'normal', 2: 'info', 4: 'warning', 8: 'critical' };

export interface QbitLogEntry {
  id: number;
  /** ISO time. */
  time: string;
  level: QbitLogLevel;
  message: string;
}

export interface QbitLogPage {
  /** Newest first. */
  entries: QbitLogEntry[];
  /** Pass as `before` for the next, older page; null when there is none. */
  nextBefore: number | null;
}

export const QBIT_LOG_PAGE_SIZE = 100;
