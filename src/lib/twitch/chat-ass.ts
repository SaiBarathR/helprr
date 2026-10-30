export interface ChatComment {
  content_offset_seconds: number;
  commenter?: { display_name?: string } | null;
  message: { body: string; user_color?: string | null };
}

const LIFETIME_SECONDS = 12;
const MAX_ON_SCREEN = 14;
const MAX_BODY_CHARS = 42;
const LINE_HEIGHT = 25;
const DEFAULT_COLOR = '#AAAAFF';
// Past libass's 40 MB budget, the player falls back to an expensive server burn-in.
export const MAX_ASS_BYTES = 35 * 1024 * 1024;
// Every message repositions those on screen, so one costs up to 14 lines of about 200 bytes.
const BYTES_PER_MESSAGE = MAX_ON_SCREEN * 200;

const HEADER = [
  '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1280', 'PlayResY: 720', 'WrapStyle: 2', '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Chat,DejaVu Sans,18,&H00FFFFFF,&H00FFFFFF,&H80000000,&HA0000000,0,0,0,0,100,100,0,0,1,1,0,7,0,0,0,1',
  '', '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
];

function stamp(seconds: number): string {
  const c = Math.round(Math.max(0, seconds) * 100);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${Math.floor(c / 360000)}:${pad(Math.floor(c / 6000) % 60)}:${pad(Math.floor(c / 100) % 60)}.${pad(c % 100)}`;
}

// Fullwidth look-alikes: chat text must never be read as ASS override tags.
function escapeText(value: string): string {
  return value.replace(/\\/g, '＼').replace(/\{/g, '｛').replace(/\}/g, '｝').replace(/[\r\n]+/g, ' ');
}

function assColor(color: string | null | undefined): string {
  const hex = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_COLOR;
  return `${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`;
}

/** The lowest per-second cap that fits, cutting only the busiest seconds. */
function thin(comments: ChatComment[], maxMessages: number): ChatComment[] {
  if (comments.length <= maxMessages) return comments;
  const perSecond = new Map<number, number>();
  for (const comment of comments) {
    const second = Math.floor(comment.content_offset_seconds);
    perSecond.set(second, (perSecond.get(second) ?? 0) + 1);
  }
  const counts = [...perSecond.values()];
  let limit = Math.max(...counts);
  while (limit > 1 && counts.reduce((total, count) => total + Math.min(count, limit), 0) > maxMessages) limit -= 1;

  const used = new Map<number, number>();
  const capped = comments.filter((comment) => {
    const second = Math.floor(comment.content_offset_seconds);
    const count = used.get(second) ?? 0;
    used.set(second, count + 1);
    return count < limit;
  });
  if (capped.length <= maxMessages) return capped;

  // Even one message a second is too many: keep an even spread across the VOD.
  const step = capped.length / Math.max(1, maxMessages);
  return Array.from({ length: Math.max(1, maxMessages) }, (_, index) => capped[Math.floor(index * step)]);
}

function render(kept: readonly ChatComment[]): string {
  const lines = [...HEADER];
  let windowStart = 0;
  kept.forEach((comment, index) => {
    const start = comment.content_offset_seconds;
    const next = kept[index + 1]?.content_offset_seconds;
    const end = Math.min(start + LIFETIME_SECONDS, next ?? start + LIFETIME_SECONDS);
    if (end <= start) return;

    // The window only moves forward, which keeps this linear in the message count.
    while (kept[windowStart].content_offset_seconds <= start - LIFETIME_SECONDS) windowStart += 1;
    const first = Math.max(windowStart, index + 1 - MAX_ON_SCREEN);

    for (let position = first; position <= index; position += 1) {
      const shown = kept[position];
      const name = escapeText(shown.commenter?.display_name ?? 'unknown');
      const body = [...escapeText(shown.message.body)].slice(0, MAX_BODY_CHARS).join('');
      const y = 690 - (index - position) * LINE_HEIGHT;
      lines.push(`Dialogue: 0,${stamp(start)},${stamp(end)},Chat,,0,0,0,,{\\pos(910,${y})\\clip(900,0,1280,720)\\c&H${assColor(shown.message.user_color)}&}${name}: {\\c&HFFFFFF&}${body}`);
    }
  });
  return `${lines.join('\n')}\n`;
}

/** Newest at the bottom of a right-hand panel. Offsets are VOD seconds. */
export function chatToAss(comments: readonly ChatComment[], maxBytes = MAX_ASS_BYTES): { ass: string; thinned: boolean } {
  const sorted = [...comments].sort((a, b) => a.content_offset_seconds - b.content_offset_seconds);
  let budget = Math.floor(maxBytes / BYTES_PER_MESSAGE);
  for (;;) {
    const kept = thin(sorted, budget);
    const ass = render(kept);
    const bytes = Buffer.byteLength(ass);
    // Emoji-heavy chat runs longer than the estimate, so the real size decides.
    if (bytes <= maxBytes || kept.length <= 1) return { ass, thinned: kept.length < sorted.length };
    // Always strictly smaller than last time, so this ends.
    budget = Math.min(kept.length - 1, Math.floor(kept.length * (maxBytes / bytes) * 0.95));
  }
}
