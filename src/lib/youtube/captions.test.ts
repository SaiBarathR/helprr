import { describe, expect, it } from 'vitest';
import { vttToSrt } from './captions';

// The opening of a real automatic caption file, from a Trash Taste episode.
const ROLLING = `WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:00.950 align:start position:0%
\u0020
First

00:00:00.950 --> 00:00:00.960 align:start position:0%
First
\u0020

00:00:00.960 --> 00:00:02.630 align:start position:0%
First
version<00:00:01.200><c> we</c><00:00:01.280><c> did,</c><00:00:01.800><c> we</c><00:00:01.880><c> had</c><00:00:02.000><c> a</c><00:00:02.100><c> 10-episode</c>

00:00:02.630 --> 00:00:02.640 align:start position:0%
version we did, we had a 10-episode
\u0020

00:00:02.640 --> 00:00:04.110 align:start position:0%
version we did, we had a 10-episode
season<00:00:03.000><c> from</c><00:00:03.200><c> Netflix.</c>
`;

describe('vttToSrt', () => {
  it('keeps each rolling line once, on screen until the next one', () => {
    expect(vttToSrt(ROLLING)).toBe(`1
00:00:00,000 --> 00:00:00,960
First

2
00:00:00,960 --> 00:00:02,640
version we did, we had a 10-episode

3
00:00:02,640 --> 00:00:04,110
season from Netflix.
`);
  });

  it('passes plain captions through, with both lines of a cue', () => {
    const plain = `WEBVTT

00:00:01.000 --> 00:00:03.000
Hello there
second line

00:00:04.000 --> 00:00:05.000
<i>Goodbye</i> &amp; thanks
`;
    expect(vttToSrt(plain)).toBe(`1
00:00:01,000 --> 00:00:03,000
Hello there
second line

2
00:00:04,000 --> 00:00:05,000
Goodbye & thanks
`);
  });

  it('gives nothing for a file with no words, so no empty sidecar is written', () => {
    expect(vttToSrt('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n \n')).toBe('');
    expect(vttToSrt('')).toBe('');
  });
});
