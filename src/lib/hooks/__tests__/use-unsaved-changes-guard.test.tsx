// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useUnsavedChangesGuard } from '../use-unsaved-changes-guard';

let root: Root;
function Page({ dirty }: { dirty: boolean }) {
  useUnsavedChangesGuard(dirty);
  return null;
}
const render = (dirty: boolean) => act(async () => root.render(<Page dirty={dirty} />));
// Whether leaving the page now would ask first.
function leaveAsks() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(() => act(() => root.unmount()));

it('asks before leaving only while there are unsaved edits', async () => {
  await render(false);
  expect(leaveAsks()).toBe(false);

  await render(true);
  expect(leaveAsks()).toBe(true);

  await render(false);
  expect(leaveAsks()).toBe(false);
});

it('stops asking once the page is gone', async () => {
  await render(true);
  await act(async () => root.unmount());
  expect(leaveAsks()).toBe(false);
  root = createRoot(document.getElementById('root')!);
});
