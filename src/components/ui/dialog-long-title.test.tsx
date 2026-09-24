// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog';

const RELEASE = 'Blade.Runner.2049.2017.PROPER.2160p.US.BluRay.REMUX.HEVC.DTS-HD.MA.TrueHD.7.1.Atmos';

let root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); });

// jsdom has no layout, so this pins the two declarations that keep a long
// unbreakable release name inside the dialog: the grid's children may shrink
// below their min-content width (otherwise the name widens the column past the
// dialog edge), and the title/description wrap the name at the edge.
describe('dialog long titles', () => {
  it('keeps Dialog content from widening past the dialog', async () => {
    await act(async () => root.render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove - {RELEASE}</DialogTitle>
            <DialogDescription>Remove &lsquo;{RELEASE}&rsquo; from the queue?</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    ));

    expect(document.querySelector('[data-slot="dialog-content"]')!.classList).toContain('*:min-w-0');
    expect(document.querySelector('[data-slot="dialog-title"]')!.classList).toContain('break-words');
    expect(document.querySelector('[data-slot="dialog-description"]')!.classList).toContain('break-words');
  });

  it('keeps AlertDialog content from widening past the dialog', async () => {
    await act(async () => root.render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {RELEASE}?</AlertDialogTitle>
            <AlertDialogDescription>{RELEASE}</AlertDialogDescription>
          </AlertDialogHeader>
        </AlertDialogContent>
      </AlertDialog>,
    ));

    expect(document.querySelector('[data-slot="alert-dialog-content"]')!.classList).toContain('*:min-w-0');
    expect(document.querySelector('[data-slot="alert-dialog-title"]')!.classList).toContain('break-words');
    expect(document.querySelector('[data-slot="alert-dialog-description"]')!.classList).toContain('break-words');
  });
});
