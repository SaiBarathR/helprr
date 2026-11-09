// @vitest-environment jsdom

import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

function Segmented() {
  const [tab, setTab] = useState('queue');
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList variant="segmented" aria-label="Sections">
        <TabsTrigger value="queue">Queue</TabsTrigger>
        <TabsTrigger value="failed">Failed</TabsTrigger>
      </TabsList>
      <TabsContent value="queue">Queue panel</TabsContent>
      <TabsContent value="failed">Failed panel</TabsContent>
    </Tabs>
  );
}

it('the segmented variant is full width on phones and its own width from sm up', () => {
  render(<Segmented />);
  const list = screen.getByRole('tablist', { name: 'Sections' });
  expect(list.dataset.variant).toBe('segmented');
  expect(list.className).toContain('w-full');
  expect(list.className).toContain('sm:w-fit');
  expect(list.className).not.toContain('inline-flex');
});

it('the segmented variant still switches tabs by click and arrow key', async () => {
  const user = userEvent.setup();
  render(<Segmented />);
  expect(screen.getByText('Queue panel')).toBeTruthy();
  await user.click(screen.getByRole('tab', { name: 'Failed' }));
  expect(screen.getByRole('tab', { name: 'Failed' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('Failed panel')).toBeTruthy();
  await user.keyboard('{ArrowLeft}');
  expect(screen.getByRole('tab', { name: 'Queue' }).getAttribute('aria-selected')).toBe('true');
});

it('rings a tab for keyboard focus only, not after a tap or click', async () => {
  const user = userEvent.setup();
  render(<Segmented />);
  const failed = screen.getByRole('tab', { name: 'Failed' });
  // The ring classes are scoped to keyboard focus (focus-key: in globals.css).
  expect(failed.className).toContain('focus-key:ring-[3px]');
  expect(failed.className).not.toContain('focus-visible:');
  await user.click(failed);
  expect(document.activeElement).toBe(failed);
  expect(failed.dataset.pointerFocus).toBe('');
  // An arrow key moves keyboard focus on: the next tab carries no pointer mark.
  await user.keyboard('{ArrowLeft}');
  const queue = screen.getByRole('tab', { name: 'Queue' });
  expect(document.activeElement).toBe(queue);
  expect(queue.dataset.pointerFocus).toBeUndefined();
  expect(failed.dataset.pointerFocus).toBeUndefined();
});

it('marks nothing for a press that never focuses the tab, so a later keyboard focus still rings', async () => {
  render(<Segmented />);
  const failed = screen.getByRole('tab', { name: 'Failed' });
  // A right-click: pointerdown, and Radix keeps the focus where it was.
  failed.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2 }));
  expect(failed.dataset.pointerFocus).toBeUndefined();
});
