// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent, DialogTitle } from './dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from './alert-dialog';

function stubViewport(height: number, offsetTop = 0) {
  const listeners = new Set<() => void>();
  const viewport = {
    height,
    scale: 1,
    offsetTop,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('visualViewport', viewport);
  return { viewport, fire: () => listeners.forEach((listener) => listener()) };
}

function openDialog() {
  render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>Add user</DialogTitle>
        <input aria-label="Username" />
      </DialogContent>
    </Dialog>,
  );
  return screen.getByRole('dialog', { name: 'Add user' });
}

describe('a centred dialog and the phone keyboard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('centres itself in the part the keyboard leaves visible', () => {
    stubViewport(400);
    const panel = openDialog();
    expect(panel.style.top).toContain('200px');
    expect(panel.style.maxHeight).toContain('400px');
  });

  it('follows iOS panning the visible part', () => {
    stubViewport(400, 100);
    const panel = openDialog();
    expect(panel.style.top).toContain('300px');
  });

  it('keeps clear of the address bar in a Safari tab', () => {
    stubViewport(400);
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)' });
    const panel = openDialog();
    expect(panel.style.top).toContain('170px');
    expect(panel.style.maxHeight).toContain('340px');
  });

  it('goes back to its own classes once the keyboard closes', async () => {
    const { viewport, fire } = stubViewport(400);
    const panel = openDialog();
    expect(panel.style.top).not.toBe('');
    viewport.height = window.innerHeight;
    fire();
    await waitFor(() => expect(panel.style.top).toBe(''));
    expect(panel.style.maxHeight).toBe('');
  });

  it('leaves a dialog alone while no keyboard is open', () => {
    stubViewport(window.innerHeight);
    const panel = openDialog();
    expect(panel.style.top).toBe('');
  });

  it('does the same for an alert dialog with a typed confirm', () => {
    stubViewport(400);
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Delete files?</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(screen.getByRole('alertdialog').style.top).toContain('200px');
  });
});
