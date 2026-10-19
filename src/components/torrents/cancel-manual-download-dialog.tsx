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
import { useCan } from '@/components/permission-provider';
import { appName, type ManualDownloadView } from './manual-download-status';

export interface CancelChoices {
  removeFromClient: boolean;
  blocklist: boolean;
  removeTitle: boolean;
}

interface CancelManualDownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  download: ManualDownloadView;
  busy: boolean;
  onConfirm: (choices: CancelChoices) => void;
}

/** Cancel a linked download, saying exactly what each choice changes and where. */
export function CancelManualDownloadDialog({ open, onOpenChange, download, busy, onConfirm }: CancelManualDownloadDialogProps) {
  const app = appName(download);
  const canDeleteTorrent = useCan('torrents.delete');
  const canDeleteTitle = useCan(download.service === 'RADARR' ? 'movies.delete' : 'series.delete');
  const offerTitle = download.createdArrItem && download.arrItemId !== null && canDeleteTitle;
  const client = download.downloadClientName ?? 'the download client';

  const [choices, setChoices] = useState<CancelChoices>({ removeFromClient: canDeleteTorrent, blocklist: false, removeTitle: offerTitle });
  // Fresh defaults each time it opens (adjusted during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setChoices({ removeFromClient: canDeleteTorrent, blocklist: false, removeTitle: offerTitle });
  }

  const effects = [
    `Remove it from ${app}'s queue on ${download.instanceLabel}.`,
    choices.removeFromClient ? `Delete the torrent and its downloaded data from ${client}.` : `Leave the torrent in ${client}.`,
    ...(choices.blocklist ? [`Blocklist this release in ${app}, without searching for another.`] : []),
    ...(choices.removeTitle ? [`Remove ${download.arrItemTitle} from ${download.instanceLabel}, only if it still has no files.`] : []),
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-base break-words">Cancel {download.arrItemTitle}?</DialogTitle>
          <DialogDescription className="break-words">{download.releaseTitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {canDeleteTorrent && (
            <Choice
              checked={choices.removeFromClient}
              onChange={(removeFromClient) => setChoices({ ...choices, removeFromClient })}
              disabled={busy}
              label={`Delete the torrent and its data from ${client}`}
            />
          )}
          <Choice
            checked={choices.blocklist}
            onChange={(blocklist) => setChoices({ ...choices, blocklist })}
            disabled={busy}
            label={`Blocklist this release in ${app}`}
            hint={`${app} refuses it from now on.`}
          />
          {offerTitle && (
            <Choice
              checked={choices.removeTitle}
              onChange={(removeTitle) => setChoices({ ...choices, removeTitle })}
              disabled={busy}
              label={`Remove ${download.arrItemTitle} from ${download.instanceLabel}`}
              hint="This download added it. It stays if it has files by then."
            />
          )}
          {choices.removeFromClient && !choices.blocklist && !choices.removeTitle && (
            <p className="text-xs text-muted-foreground">
              Without a blocklist, {app} counts this as a recent grab and may turn down another release of this title for 12 hours.
            </p>
          )}
        </div>

        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="tracked-caps text-[10px] text-muted-foreground">This will</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs">
            {effects.map((effect) => <li key={effect}>{effect}</li>)}
          </ul>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Keep it</Button>
          <Button variant="destructive" onClick={() => onConfirm(choices)} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cancel download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Choice({ checked, onChange, disabled, label, hint }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex min-h-[44px] items-start gap-3 py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border"
      />
      <span className="space-y-0.5">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}
