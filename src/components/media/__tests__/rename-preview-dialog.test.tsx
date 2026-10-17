// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RenamePreviewDialog } from '../rename-preview-dialog';

let root: Root;
let queryClient: QueryClient;
let files: { movieFileId: number; existingPath: string; newPath: string }[];

const fileBoxes = () => [...document.querySelectorAll<HTMLButtonElement>('button[role="checkbox"][aria-label="Select file"]')];
const checked = () => fileBoxes().map((box) => box.getAttribute('aria-checked') === 'true');

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  files = [
    { movieFileId: 1, existingPath: 'Old.One.mkv', newPath: 'New One (1999).mkv' },
    { movieFileId: 2, existingPath: 'Old.Two.mkv', newPath: 'New Two (2003).mkv' },
  ];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(files), { status: 200 })));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <RenamePreviewDialog open onOpenChange={() => {}} service="radarr" mediaId={1} mediaTitle="The Matrix" />
    </QueryClientProvider>,
  ));
  await vi.waitFor(() => expect(fileBoxes()).toHaveLength(2));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it('selects every file once the preview loads', () => {
  expect(checked()).toEqual([true, true]);
});

it('keeps a file the user deselected through a background refetch', async () => {
  await act(async () => fileBoxes()[0].click());
  expect(checked()).toEqual([false, true]);

  files = [...files, { movieFileId: 3, existingPath: 'Old.Three.mkv', newPath: 'New Three (2003).mkv' }];
  await act(async () => { await queryClient.refetchQueries(); });
  await vi.waitFor(() => expect(fileBoxes()).toHaveLength(3));

  expect(checked()).toEqual([false, true, false]);
});
