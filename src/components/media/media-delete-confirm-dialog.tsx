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
  /**
   * Offer the "Add import-list exclusion" checkbox (default off). Only for
   * Sonarr/Radarr/Lidarr titles: without it an import list or a monitored
   * collection can add the title straight back.
   */
  showImportListExclusion?: boolean;
  busy?: boolean;
  onConfirm: (deleteFiles: boolean, addImportListExclusion: boolean) => void | Promise<void>;
}

/**
 * Shared destructive confirmation for library media (single item or bulk
 * selection): ConfirmDialog plus the optional delete-files-from-disk and
 * import-list-exclusion checkboxes, which reset whenever the dialog closes.
 */
export function MediaDeleteConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  showDeleteFiles = true,
  showImportListExclusion = false,
  busy = false,
  onConfirm,
}: MediaDeleteConfirmDialogProps) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [addExclusion, setAddExclusion] = useState(false);

  // Reset on `open` rather than in onOpenChange: a parent that closes the
  // dialog itself, as the bulk bar does after a confirm, never goes through
  // that, and a delete that failed left the boxes ticked for the next attempt.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setDeleteFiles(false);
      setAddExclusion(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        <span className="space-y-3">
          {description && <span className="block">{description}</span>}
          {/* One block, so the 44px rows sit together rather than space-y apart. */}
          {(showDeleteFiles || showImportListExclusion) && (
            <span className="block">
              {showDeleteFiles && (
                <label className="flex min-h-11 items-center gap-2 text-foreground">
                  <Checkbox
                    checked={deleteFiles}
                    onCheckedChange={(checked) => setDeleteFiles(checked === true)}
                    disabled={busy}
                  />
                  Also delete files from disk
                </label>
              )}
              {showImportListExclusion && (
                <label className="flex min-h-11 items-center gap-2 text-foreground">
                  <Checkbox
                    checked={addExclusion}
                    onCheckedChange={(checked) => setAddExclusion(checked === true)}
                    disabled={busy}
                  />
                  Add import-list exclusion
                </label>
              )}
            </span>
          )}
        </span>
      }
      confirmLabel={confirmLabel}
      destructive
      busy={busy}
      onConfirm={() => onConfirm(deleteFiles, showImportListExclusion && addExclusion)}
    />
  );
}
