// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { JellyfinItem } from '@/types/jellyfin';
import { QueuePanel } from '../queue-panel';

// "Queue" and its ✕ came out soft in the iPhone Home Screen app: they sat in
// iOS's blur band. globals.css sets --ios-app-top-drop only there.
it('drops its heading below the iOS blur band in the Home Screen app', () => {
  Element.prototype.scrollIntoView = vi.fn();
  const film = { Id: 'f1', Name: '2001: A Space Odyssey', Type: 'Movie' } as JellyfinItem;
  render(<QueuePanel queue={[film]} index={0} onPick={() => {}} onClose={() => {}} />);

  const header = screen.getByText('Queue').parentElement!.parentElement!;
  expect(header.className).toContain('pt-[max(0.75rem,calc(env(safe-area-inset-top)+var(--ios-app-top-drop,0px)))]');
  expect(screen.getByRole('button', { name: 'Close queue' }).parentElement).toBe(header);
});
