/** Asked for by a person: claimed at once, whatever the night window says. */
export const REENCODE_NOW_PRIORITY = 100;

function minutes(value: string): number {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
}

/** Whether a local time falls in the window, which may cross midnight. */
export function inReencodeWindow(now: Date, start: string, end: string): boolean {
  const current = now.getHours() * 60 + now.getMinutes();
  const from = minutes(start);
  const to = minutes(end);
  if (from === to) return true;
  return from < to ? current >= from && current < to : current >= from || current < to;
}

/** A new file has to earn the swap. */
export function worthKeeping(originalBytes: number, encodedBytes: number): boolean {
  return encodedBytes <= originalBytes * 0.9;
}
