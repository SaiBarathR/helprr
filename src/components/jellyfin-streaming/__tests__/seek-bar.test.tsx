// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeekBar } from '../video-stage';

/**
 * The seek bar previews while the thumb is held and seeks once on release.
 *
 * Found on iOS against a real library: a tap on the bar did not seek. iOS sets
 * a tapped slider's value *after* `pointerup`, so the release had nothing to
 * commit, the preview stayed up, and the next touch seeked to the previous
 * tap's position.
 */
describe('SeekBar', () => {
  let host: HTMLDivElement;
  let root: Root;
  let onSeek: ReturnType<typeof vi.fn<(seconds: number) => void>>;
  let input: HTMLInputElement;

  const fire = (type: string) => act(async () => { input.dispatchEvent(new Event(type, { bubbles: true })); });
  const moveTo = (seconds: number) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(seconds));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    onSeek = vi.fn<(seconds: number) => void>();
    await act(async () => root.render(<SeekBar positionSeconds={60} durationSeconds={3600} onSeek={onSeek} />));
    input = host.querySelector('input[aria-label="Seek"]')!;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('seeks once on release after a drag, not at every step', async () => {
    await fire('pointerdown');
    await moveTo(600);
    await moveTo(1200);
    expect(onSeek).not.toHaveBeenCalled();
    await fire('pointerup');
    expect(onSeek.mock.calls).toEqual([[1200]]);
  });

  it('seeks on an iOS tap, where the value arrives after the release', async () => {
    await fire('pointerdown');
    await fire('pointerup');
    await moveTo(2274);
    expect(onSeek.mock.calls).toEqual([[2274]]);
  });

  it('sends each iOS tap to its own position', async () => {
    await fire('pointerdown');
    await fire('pointerup');
    await moveTo(2274);
    await fire('pointerdown');
    await fire('pointerup');
    await moveTo(972);
    expect(onSeek.mock.calls).toEqual([[2274], [972]]);
  });

  it('seeks once when an arrow key is released, however long it was held', async () => {
    await fire('keydown');
    await moveTo(60.1);
    await moveTo(60.2);
    expect(onSeek).not.toHaveBeenCalled();
    await fire('keyup');
    expect(onSeek.mock.calls).toEqual([[60.2]]);
  });

  it('still seeks when the touch is cancelled instead of released', async () => {
    await fire('pointerdown');
    await moveTo(900);
    await fire('pointercancel');
    expect(onSeek.mock.calls).toEqual([[900]]);
  });
});
