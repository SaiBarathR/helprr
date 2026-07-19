'use client';

import { useState, type ReactNode } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface MediaDeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Full dialog title, e.g. `Delete “Alien”?` or `Delete 3 movies?` */
  title: ReactNode;
  /** Body copy rendered above the delete-files checkbox. */
  description?: ReactNode;
  confirmLabel?: string;
  /** Offer the "Also delete files from disk" checkbox (default on). */
  showDeleteFiles?: boolean;
  busy?: boolean;
  onConfirm: (deleteFiles: boolean) => void | Promise<void>;
}

/**
 * Shared destructive confirmation for library media (single item or bulk
 * selection): ConfirmDialog plus the optional delete-files-from-disk
 * checkbox, which resets whenever the dialog closes.
 */
export function MediaDeleteConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  showDeleteFiles = true,
  busy = false,
  onConfirm,
}: MediaDeleteConfirmDialogProps) {
  const [deleteFiles, setDeleteFiles] = useState(false);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setDeleteFiles(false);
        onOpenChange(next);
      }}
      title={title}
      description={
        <span className="space-y-3">
          {description && <span className="block">{description}</span>}
          {showDeleteFiles && (
            <label className="flex items-center gap-2 text-foreground">
              <Checkbox
                checked={deleteFiles}
                onCheckedChange={(checked) => setDeleteFiles(checked === true)}
                disabled={busy}
              />
              Also delete files from disk
            </label>
          )}
        </span>
      }
      confirmLabel={confirmLabel}
      destructive
      busy={busy}
      onConfirm={() => onConfirm(deleteFiles)}
    />
  );
}
