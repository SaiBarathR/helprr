import { describe, expect, it } from 'vitest';
import { chatToAss, type ChatComment } from '@/lib/twitch/chat-ass';

const comment = (at: number, body = 'hello', name = 'viewer', color: string | null = '#FF0000'): ChatComment => ({
  content_offset_seconds: at,
  commenter: { display_name: name },
  message: { body, user_color: color },
});
const dialogue = (ass: string) => ass.split('\n').filter((line) => line.startsWith('Dialogue:'));

describe('chatToAss', () => {
  it('writes a valid header and one line for a lone message', () => {
    const { ass, thinned } = chatToAss([comment(1)]);
    expect(ass).toContain('[V4+ Styles]');
    expect(dialogue(ass)).toEqual([
      'Dialogue: 0,0:00:01.00,0:00:13.00,Chat,,0,0,0,,{\\pos(910,690)\\clip(900,0,1280,720)\\c&H0000FF&}viewer: {\\c&HFFFFFF&}hello',
    ]);
    expect(thinned).toBe(false);
  });

  it('formats hours in timestamps', () => {
    expect(dialogue(chatToAss([comment(3661.5)]).ass)[0]).toContain('1:01:01.50');
  });

  it('turns a username colour into ASS BGR, and refuses anything else', () => {
    expect(dialogue(chatToAss([comment(1, 'x', 'v', '#112233')]).ass)[0]).toContain('\\c&H332211&');
    expect(dialogue(chatToAss([comment(1, 'x', 'v', 'red}{\\evil')]).ass)[0]).toContain('\\c&HFFAAAA&');
    expect(dialogue(chatToAss([comment(1, 'x', 'v', null)]).ass)[0]).toContain('\\c&HFFAAAA&');
  });

  it('cannot be made to inject ASS tags from chat', () => {
    const line = dialogue(chatToAss([comment(1, '{\\fs200}big\\N', '{\\pos(0,0)}name')]).ass)[0];
    const text = line.slice(line.indexOf('viewer') === -1 ? line.indexOf('}') : 0);
    expect(text).not.toContain('{\\fs200}');
    expect(text).not.toContain('{\\pos(0,0)}name');
    expect(line).toContain('｛＼fs200｝big＼N');
  });

  it('stacks recent messages, newest at the bottom, and ends each frame at the next message', () => {
    const lines = dialogue(chatToAss([comment(1, 'first'), comment(2, 'second')]).ass);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('0:00:02.00,Chat');
    expect(lines[1]).toContain('\\pos(910,665)');
    expect(lines[1]).toContain('first');
    expect(lines[2]).toContain('\\pos(910,690)');
    expect(lines[2]).toContain('second');
  });

  it('drops a message older than its lifetime from the panel', () => {
    const lines = dialogue(chatToAss([comment(1, 'old'), comment(20, 'new')]).ass);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('new');
  });

  it('shows at most fourteen messages', () => {
    const many = Array.from({ length: 30 }, (_, index) => comment(index * 0.1));
    expect(dialogue(chatToAss(many).ass).filter((line) => line.includes('0:00:02.90,0'))).toHaveLength(14);
  });

  it('truncates long messages by character, not by emoji half', () => {
    const line = dialogue(chatToAss([comment(1, '😀'.repeat(100))]).ass)[0];
    expect([...line.split('&}')[2]]).toHaveLength(42);
  });

  it('skips a message that shares its timestamp with the next', () => {
    expect(dialogue(chatToAss([comment(1, 'a'), comment(1, 'b')]).ass).some((line) => line.includes('b'))).toBe(true);
  });

  it('stays under the size cap on a busy chat, and says it thinned', () => {
    const busy = Array.from({ length: 200_000 }, (_, index) => comment(index / 50, 'a'.repeat(30)));
    const maxBytes = 5 * 1024 * 1024;
    const { ass, thinned } = chatToAss(busy, maxBytes);
    expect(Buffer.byteLength(ass)).toBeLessThan(maxBytes);
    expect(thinned).toBe(true);
    expect(dialogue(ass).length).toBeGreaterThan(1000);
  });

  it('still fits, and still ends, when one message a second is too much', () => {
    const tenHours = Array.from({ length: 36_000 }, (_, index) => comment(index, '😀'.repeat(42)));
    const maxBytes = 1024 * 1024;
    const { ass, thinned } = chatToAss(tenHours, maxBytes);
    expect(Buffer.byteLength(ass)).toBeLessThanOrEqual(maxBytes);
    expect(thinned).toBe(true);
    const lines = dialogue(ass);
    expect(lines[lines.length - 1].slice(0, 30)).toMatch(/Dialogue: 0,(9|8):/);
  });

  it('cuts the busiest seconds first and leaves quiet ones alone', () => {
    const quiet = Array.from({ length: 50 }, (_, index) => comment(index, 'quiet'));
    const burst = Array.from({ length: 5000 }, (_, index) => comment(100 + index / 5000, 'burst'));
    const { ass } = chatToAss([...quiet, ...burst], 2 * 1024 * 1024);
    expect(dialogue(ass).filter((line) => line.includes('quiet')).length).toBeGreaterThanOrEqual(50);
  });

  it('handles an empty chat', () => {
    expect(dialogue(chatToAss([]).ass)).toEqual([]);
  });
});
