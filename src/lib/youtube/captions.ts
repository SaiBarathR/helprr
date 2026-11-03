const TIMING = /(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/;
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&#39;': "'", '&quot;': '"' };

function cleanLine(line: string): string {
  return line
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|nbsp|quot|#39);/g, (entity) => ENTITIES[entity])
    .trim();
}

/**
 * YouTube's automatic captions roll: each line shows up in two or three cues, with cues of
 * 10 ms holding it on screen. Only the first sighting is kept, and it stays until the
 * next new line. Plain captions pass straight through.
 */
export function vttToSrt(vtt: string): string {
  const cues: Array<{ start: string; end: string; lines: string[] }> = [];
  let onScreen: string[] = [];

  for (const block of vtt.split(/\r?\n\r?\n/)) {
    const rows = block.split(/\r?\n/);
    const timingRow = rows.findIndex((row) => TIMING.test(row));
    if (timingRow < 0) continue;
    const [, start, end] = TIMING.exec(rows[timingRow])!;
    const lines = rows.slice(timingRow + 1).map(cleanLine).filter(Boolean);
    const fresh = lines.filter((line) => !onScreen.includes(line));
    if (lines.length > 0) onScreen = lines;
    const last = cues.at(-1);
    if (fresh.length > 0) cues.push({ start, end, lines: fresh });
    else if (last) last.end = end;
  }

  return cues
    .map((cue, index) => `${index + 1}\n${cue.start.replace('.', ',')} --> ${cue.end.replace('.', ',')}\n${cue.lines.join('\n')}\n`)
    .join('\n');
}
