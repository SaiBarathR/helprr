'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type RemovalMethod = 'removeFromClient' | 'changeCategory' | 'ignore';

/** Blocklist choice: leave alone, blocklist + search for a replacement, or blocklist only. */
type BlocklistMode = 'none' | 'search' | 'only';

export interface RemoveQueueOptions {
  method: RemovalMethod;
  blocklist: boolean;
  skipRedownload: boolean;
}

interface RemoveQueueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Release title shown in the header/body. */
  title: string;
  /** Display name of the *arr app driving the queue (Sonarr/Radarr/Lidarr) — used in hint copy. */
  appName: string;
  /** Whether the download client has a Post-Import Category configured (gates "Change Category"). */
  canChangeCategory: boolean;
  busy: boolean;
  onConfirm: (options: RemoveQueueOptions) => void;
}

export function RemoveQueueDialog({
  open,
  onOpenChange,
  title,
  appName,
  canChangeCategory,
  busy,
  onConfirm,
}: RemoveQueueDialogProps) {
  const [method, setMethod] = useState<RemovalMethod>('removeFromClient');
  const [blocklistMode, setBlocklistMode] = useState<BlocklistMode>('none');

  // Reset to defaults each time the dialog opens for a fresh item. Resetting during
  // render on the open transition avoids a setState-in-effect cascade.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMethod('removeFromClient');
      setBlocklistMode('none');
    }
  }

  const methodHint =
    method === 'removeFromClient'
      ? `'Remove from Download Client' will remove the download and the file(s) from the download client.`
      : method === 'changeCategory'
        ? `'Change Category' will change the download to the 'Post-Import Category' in the download client.`
        : `'Ignore Download' will stop ${appName} from processing this download further.`;

  const blocklistHint =
    blocklistMode === 'none'
      ? 'Remove without blocklisting.'
      : blocklistMode === 'search'
        ? `Blocklist this release and search for a replacement.`
        : `Blocklist this release without searching for a replacement.`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-base break-words">Remove - {title}</DialogTitle>
          <DialogDescription>
            Are you sure you want to remove &lsquo;{title}&rsquo; from the queue?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="removal-method">Removal Method</Label>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as RemovalMethod)}
              disabled={busy}
            >
              <SelectTrigger id="removal-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="removeFromClient">Remove from Download Client</SelectItem>
                {canChangeCategory && (
                  <SelectItem value="changeCategory">Change Category</SelectItem>
                )}
                <SelectItem value="ignore">Ignore Download</SelectItem>
              </SelectContent>
            </Select>
            <p
              className={`text-xs ${
                method === 'removeFromClient' ? 'text-amber-500' : 'text-muted-foreground'
              }`}
            >
              {methodHint}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="blocklist-release">Blocklist Release</Label>
            <Select
              value={blocklistMode}
              onValueChange={(v) => setBlocklistMode(v as BlocklistMode)}
              disabled={busy}
            >
              <SelectTrigger id="blocklist-release" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Do not Blocklist</SelectItem>
                <SelectItem value="search">Blocklist and Search</SelectItem>
                <SelectItem value="only">Blocklist Only</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{blocklistHint}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Close
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              onConfirm({
                method,
                blocklist: blocklistMode !== 'none',
                skipRedownload: blocklistMode === 'only',
              })
            }
            disabled={busy}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
