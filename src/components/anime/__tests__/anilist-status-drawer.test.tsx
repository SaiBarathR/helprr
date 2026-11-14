// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ children }: { children: React.ReactNode }) => children,
  DrawerContent: ({ children }: { children: React.ReactNode }) => children,
  DrawerHeader: ({ children }: { children: React.ReactNode }) => children,
  DrawerTitle: ({ children }: { children: React.ReactNode }) => children,
  DrawerDescription: ({ children }: { children: React.ReactNode }) => children,
  DrawerFooter: ({ children }: { children: React.ReactNode }) => children,
}));

import { AnilistStatusDrawer } from '../anilist-status-drawer';

const entry = {
  id: 7,
  status: 'CURRENT' as const,
  score: 8,
  progress: 3,
  progressVolumes: 1,
  repeat: 0,
  notes: null,
  startedAt: null,
  completedAt: null,
  updatedAt: null,
};

it('names the remove button and every field of the Edit entry sheet', () => {
  render(
    <AnilistStatusDrawer
      open
      onOpenChange={() => {}}
      mediaId={1}
      mediaTitle="Frieren"
      mediaType="MANGA"
      entry={entry}
      scoreFormat="POINT_10"
      onSaved={() => {}}
      onDeleted={() => {}}
    />,
  );
  expect(screen.getByRole('button', { name: 'Remove from AniList' })).toBeTruthy();
  expect(screen.getByRole('combobox', { name: 'Status' })).toBeTruthy();
  expect(screen.getByRole('spinbutton', { name: /Score/ })).toBeTruthy();
  expect(screen.getByRole('spinbutton', { name: /Chapter Progress/ })).toBeTruthy();
  expect(screen.getByRole('spinbutton', { name: /Volume Progress/ })).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'Notes' })).toBeTruthy();
});
