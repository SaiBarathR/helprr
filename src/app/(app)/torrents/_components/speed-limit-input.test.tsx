// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
import { SpeedLimitInput, formatSpeedLimit } from './speed-limit-input';

let root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); });

async function renderInput(currentLimit: number, onSave: (limit: number) => Promise<boolean | void>) {
  await act(async () => root.render(<SpeedLimitInput label="Download Limit" currentLimit={currentLimit} onSave={onSave} />));
  await act(async () => document.querySelector<HTMLButtonElement>('button.grouped-row')!.click());
}

async function typeValue(value: string) {
  const input = document.querySelector('input')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const submit = () => act(async () => document.querySelector('form')!.requestSubmit());
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === text)!;

describe('SpeedLimitInput', () => {
  it('shows zero and negative limits as unlimited', () => {
    expect(formatSpeedLimit(0)).toBe('Unlimited');
    expect(formatSpeedLimit(-1)).toBe('Unlimited');
    expect(formatSpeedLimit(512 * 1024)).toBe('512 KB/s');
    expect(formatSpeedLimit(5 * 1024 * 1024)).toBe('5 MB/s');
  });

  it('opens prefilled in the unit that fits the current limit', async () => {
    await renderInput(512 * 1024, vi.fn());

    expect(document.querySelector('input')!.value).toBe('512');
    expect(document.querySelector('[data-slot="select-trigger"]')!.textContent).toContain('KB/s');
  });

  it('saves in bytes per second on submit, so the keyboard return key works', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    await renderInput(0, onSave);
    await typeValue('1.5');
    await submit();

    expect(onSave).toHaveBeenCalledWith(1.5 * 1024 * 1024);
    expect(document.querySelector('form')).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('Download Limit updated');
  });

  it('keeps the editor open when the caller already reported a failure', async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    await renderInput(0, onSave);
    await typeValue('2');
    await submit();

    expect(document.querySelector('form')).not.toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('reports a thrown failure itself', async () => {
    await renderInput(0, vi.fn().mockRejectedValue(new Error('offline')));
    await typeValue('2');
    await submit();

    expect(toast.error).toHaveBeenCalledWith('Failed to set download limit');
    expect(document.querySelector('form')).not.toBeNull();
  });

  it('sets unlimited with one tap', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    await renderInput(5 * 1024 * 1024, onSave);
    await act(async () => button('Unlimited').click());

    expect(onSave).toHaveBeenCalledWith(0);
    expect(toast.success).toHaveBeenCalledWith('Download Limit set to unlimited');
  });

  it('refuses an empty value without saving', async () => {
    const onSave = vi.fn();
    await renderInput(0, onSave);
    await submit();

    expect(onSave).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Invalid speed value');
  });

  it('shows Mixed for torrents that disagree and opens the editor empty', async () => {
    await act(async () => root.render(
      <SpeedLimitInput label="Download Limit" currentLimit={512 * 1024} mixed onSave={vi.fn()} />,
    ));
    expect(document.querySelector('button.grouped-row')!.textContent).toContain('Mixed');

    await act(async () => document.querySelector<HTMLButtonElement>('button.grouped-row')!.click());
    expect(document.querySelector('input')!.value).toBe('');
    expect(document.querySelector('[data-slot="select-trigger"]')!.textContent).toContain('MB/s');
  });

  it('names who the limit applies to in its messages', async () => {
    await act(async () => root.render(
      <SpeedLimitInput label="Upload Limit" currentLimit={0} target="3 torrents" onSave={vi.fn().mockResolvedValue(true)} />,
    ));
    await act(async () => document.querySelector<HTMLButtonElement>('button.grouped-row')!.click());
    await act(async () => button('Unlimited').click());

    expect(toast.success).toHaveBeenCalledWith('Upload Limit set to unlimited for 3 torrents');
  });

  it('cancels without saving', async () => {
    const onSave = vi.fn();
    await renderInput(0, onSave);
    await typeValue('9');
    await act(async () => button('Cancel').click());

    expect(onSave).not.toHaveBeenCalled();
    expect(document.querySelector('button.grouped-row')!.textContent).toContain('Unlimited');
  });
});
