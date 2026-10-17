// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../confirm-dialog';

function renderDialog() {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Delete the series?"
      description="Its files stay on disk."
      confirmLabel="Delete"
      destructive
      onConfirm={onConfirm}
    />,
  );
  return { onOpenChange, onConfirm };
}

describe('ConfirmDialog', () => {
  it('confirms without closing itself, so the caller decides what comes next', async () => {
    const { onOpenChange, onConfirm } = renderDialog();
    expect(screen.getByRole('alertdialog', { name: 'Delete the series?' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('starts each test from an empty page, then closes on Cancel', async () => {
    // The shared setup unmounted the previous test's dialog.
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const { onOpenChange, onConfirm } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
