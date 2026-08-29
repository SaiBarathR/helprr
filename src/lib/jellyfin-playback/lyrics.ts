import { TICKS_PER_SECOND } from '@/types/jellyfin-streaming';
import type { HelprrLyricLine } from '@/types/jellyfin-streaming';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function lineFromUnknown(entry: unknown): HelprrLyricLine | null {
  if (typeof entry === 'string') {
    const text = entry.trim();
    return text ? { text, startSeconds: null } : null;
  }
  const row = asRecord(entry);
  if (!row) return null;
  const text = typeof row.Text === 'string' ? row.Text : typeof row.text === 'string' ? row.text : '';
  if (!text.trim()) return null;
  const ticks = typeof row.Start === 'number' ? row.Start : typeof row.start === 'number' ? row.start : null;
  return {
    text,
    startSeconds: ticks != null && ticks >= 0 ? ticks / TICKS_PER_SECOND : null,
  };
}

export function normalizeJellyfinLyrics(raw: unknown): HelprrLyricLine[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    return raw.split(/\r?\n/).map((text) => text.trim()).filter(Boolean).map((text) => ({
      text,
      startSeconds: null,
    }));
  }
  const bag = Array.isArray(raw)
    ? raw
    : asRecord(raw)?.Lyrics;
  if (!Array.isArray(bag)) return [];
  return bag.map(lineFromUnknown).filter((line): line is HelprrLyricLine => Boolean(line));
}

export function activeLyricIndex(lines: HelprrLyricLine[], positionSeconds: number): number {
  let active = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const start = lines[index]?.startSeconds;
    if (start == null || start <= positionSeconds) active = index;
    else break;
  }
  return active;
}
