'use client';

import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface SingleMediaDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  itemNoun: string;
  busy?: boolean;
  onConfirm: (deleteFiles: boolean) => void | Promise<void>;
}

/** Single-entity equivalent of the library bulk delete confirmation. */
export function SingleMediaDeleteDialog({
  open,
  onOpenChange,
  title,
  itemNoun,
  busy = false,
  onConfirm,
}: SingleMediaDeleteDialogProps) {
  const [deleteFiles, setDeleteFiles] = useState(false);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setDeleteFiles(false);
        onOpenChange(next);
      }}
      title={`Delete “${title}”?`}
      description={
        <span className="space-y-3">
          <span className="block">
            This removes the {itemNoun} from its connected service.
          </span>
          <label className="flex items-center gap-2 text-foreground">
            <Checkbox
              checked={deleteFiles}
              onCheckedChange={(checked) => setDeleteFiles(checked === true)}
              disabled={busy}
            />
            Also delete files from disk
          </label>
        </span>
      }
      confirmLabel="Delete"
      destructive
      busy={busy}
      onConfirm={() => onConfirm(deleteFiles)}
    />
  );
}
