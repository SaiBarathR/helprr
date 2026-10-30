export interface YtDlpChapter {
  start_time: number;
  end_time?: number | null;
  title?: string | null;
}

// FFMETADATA treats these as syntax inside a value.
function escapeValue(value: string): string {
  return value.replace(/[\\=;#\n]/g, (char) => `\\${char}`);
}

/** Chapter ends clipped to the real duration, which Twitch's game changes can overrun. */
export function chaptersToFfmetadata(chapters: readonly YtDlpChapter[], durationSeconds: number): string | null {
  const totalMs = Math.round(durationSeconds * 1000);
  const lines = [';FFMETADATA1'];
  const sorted = [...chapters].sort((a, b) => a.start_time - b.start_time);
  sorted.forEach((chapter, index) => {
    const start = Math.round(chapter.start_time * 1000);
    if (start >= totalMs) return;
    const next = sorted[index + 1]?.start_time;
    const end = Math.min(Math.round((chapter.end_time ?? next ?? durationSeconds) * 1000), totalMs);
    if (end <= start) return;
    lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${start}`, `END=${end}`, `title=${escapeValue(chapter.title?.trim() || 'Stream')}`);
  });
  return lines.length > 1 ? `${lines.join('\n')}\n` : null;
}

export function chapterGenres(chapters: readonly YtDlpChapter[]): string[] {
  return [...new Set(chapters.map((chapter) => chapter.title?.trim()).filter((title): title is string => Boolean(title)))];
}
