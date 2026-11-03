import { describe, expect, it } from 'vitest';
import { isChannelId, isPlaylistId, isVideoId, parseChannelInput, parsePlaylistLink, parseVideoLink } from './ids';

const CHANNEL = 'UCXuqSBlHAE6Xw-yeJA0Tunw';

describe('parseChannelInput', () => {
  it.each([
    ['@wanshowyt', { handle: 'wanshowyt' }],
    ['  @TrashTaste ', { handle: 'TrashTaste' }],
    ['https://youtube.com/@wanshowyt?si=abc', { handle: 'wanshowyt' }],
    ['https://www.youtube.com/@mkbhd/videos', { handle: 'mkbhd' }],
    ['m.youtube.com/@t3dotgg', { handle: 't3dotgg' }],
    [`https://www.youtube.com/channel/${CHANNEL}`, { channelId: CHANNEL }],
    [CHANNEL, { channelId: CHANNEL }],
  ])('reads %s', (input, expected) => {
    expect(parseChannelInput(input)).toEqual(expected);
  });

  it.each([
    '', 'not a channel', '@', '@a', '@has space', '@../../etc',
    'https://evil.example/@wanshowyt',
    'https://youtube.com.evil.example/@wanshowyt',
    'https://user:pass@youtube.com/@wanshowyt',
    'https://youtube.com:8443/@wanshowyt',
    'https://www.youtube.com/channel/UCshort',
    'javascript:alert(1)',
  ])('refuses %s', (input) => {
    expect(parseChannelInput(input)).toBeNull();
  });
});

describe('parseVideoLink', () => {
  it.each([
    ['https://www.youtube.com/watch?v=ZoZ7m020aJQ&t=10', 'ZoZ7m020aJQ'],
    ['https://youtu.be/ZoZ7m020aJQ?si=abc', 'ZoZ7m020aJQ'],
    ['https://www.youtube.com/shorts/9st7OYkUHJk', '9st7OYkUHJk'],
    ['https://www.youtube.com/live/z7rgGfE8sug', 'z7rgGfE8sug'],
    ['https://music.youtube.com/watch?v=ZoZ7m020aJQ', 'ZoZ7m020aJQ'],
  ])('reads %s', (input, expected) => {
    expect(parseVideoLink(input)).toBe(expected);
  });

  it.each([
    'https://evil.example/watch?v=ZoZ7m020aJQ',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=ZoZ7m020aJQ;rm',
    'https://www.youtube.com/watch',
    '--exec=evil',
    'https://www.youtube.com/@mkbhd',
  ])('refuses %s', (input) => {
    expect(parseVideoLink(input)).toBeNull();
  });
});

describe('parsePlaylistLink', () => {
  it('reads a playlist from any page that carries one', () => {
    const id = 'PL8mG-RkN2uTw7PhlnAr4pZZz2QubIbujH';
    expect(parsePlaylistLink(`https://www.youtube.com/playlist?list=${id}`)).toBe(id);
    expect(parsePlaylistLink(`https://www.youtube.com/watch?v=ZoZ7m020aJQ&list=${id}`)).toBe(id);
  });

  it('refuses another host, and a list that is not one', () => {
    expect(parsePlaylistLink('https://evil.example/playlist?list=PL8mG-RkN2uTw7PhlnAr4pZZz2QubIbujH')).toBeNull();
    expect(parsePlaylistLink('https://www.youtube.com/playlist?list=nope')).toBeNull();
    expect(parsePlaylistLink('https://www.youtube.com/playlist?list=--exec')).toBeNull();
  });
});

describe('id checks', () => {
  it('holds each id to its own shape', () => {
    expect(isVideoId('ZoZ7m020aJQ')).toBe(true);
    expect(isVideoId('../etc/pass')).toBe(false);
    expect(isChannelId(CHANNEL)).toBe(true);
    expect(isChannelId('UCshort')).toBe(false);
    expect(isPlaylistId('UUXuqSBlHAE6Xw-yeJA0Tunw')).toBe(true);
    expect(isPlaylistId('; rm -rf')).toBe(false);
  });
});
