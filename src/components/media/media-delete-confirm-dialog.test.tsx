// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MediaDeleteConfirmDialog } from './media-delete-confirm-dialog';

let container: HTMLDivElement;
let root: Root;
const onConfirm = vi.fn();

const render = (open: boolean) => act(async () => {
  root.render(<MediaDeleteConfirmDialog open={open} onOpenChange={() => {}} title="Delete 2 movies?" onConfirm={onConfirm} />);
});
const box = () => document.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
const confirm = () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Delete')!;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onConfirm.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

// The bulk bar closes the dialog itself once a delete has been attempted. When
// the delete failed, the selection and the dialog stayed mounted, and the next
// attempt opened with file deletion already chosen.
it('asks about deleting files afresh after its parent closed it', async () => {
  await render(true);
  await act(async () => { box().click(); });
  expect(box().getAttribute('aria-checked')).toBe('true');
  await act(async () => { confirm().click(); });
  expect(onConfirm).toHaveBeenLastCalledWith(true);

  await render(false);
  await render(true);

  expect(box().getAttribute('aria-checked')).toBe('false');
  await act(async () => { confirm().click(); });
  expect(onConfirm).toHaveBeenLastCalledWith(false);
});
