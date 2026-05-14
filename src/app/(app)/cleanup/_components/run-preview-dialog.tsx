'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';

export interface QueueDryRunDecision {
  hash: string;
  torrentName: string;
  strikeType: string;
  ruleName: string | null;
  reason: string;
  linkedArrSource: string | null;
  linkedArrTitle: string | null;
  options: { reSearch: boolean; deletePrivate: boolean; changeCategory: boolean };
}

export interface DownloadDryRunDecision {
  hash: string;
  torrentName: string;
  ruleName: string;
  reason: string;
  seedingHours: number;
  ratio: number;
  deleteSourceFiles: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  loading: boolean;
  decisions: QueueDryRunDecision[] | DownloadDryRunDecision[];
  pendingStrikes?: { torrentName: string; strikeType: string; ruleName: string | null; count: number; maxStrikes: number }[];
  onConfirm: () => void;
  confirming: boolean;
  cleaner: 'queue' | 'download';
}

export function RunPreviewDialog(props: Props) {
  const { open, onOpenChange, title, loading, decisions, pendingStrikes, onConfirm, confirming, cleaner } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="py-12 flex items-center justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Running dry-run…
          </div>
        ) : (
          <div className="space-y-4">
            {pendingStrikes && pendingStrikes.length > 0 && (
              <section>
                <h3 className="text-sm font-medium mb-2">Strikes that would accumulate ({pendingStrikes.length})</h3>
                <ScrollArea className="max-h-48 rounded-md border">
                  <ul className="divide-y">
                    {pendingStrikes.map((s, idx) => (
                      <li key={idx} className="px-3 py-2 text-sm flex items-center justify-between gap-3">
                        <div className="min-w-0 truncate">
                          <div className="truncate font-medium">{s.torrentName}</div>
                          <div className="text-xs text-muted-foreground">
                            {s.strikeType}{s.ruleName ? ` · ${s.ruleName}` : ''}
                          </div>
                        </div>
                        <Badge variant="outline" className="shrink-0">{s.count}/{s.maxStrikes}</Badge>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </section>
            )}

            <section>
              <h3 className="text-sm font-medium mb-2">Would be removed now ({decisions.length})</h3>
              {decisions.length === 0 ? (
                <div className="text-sm text-muted-foreground rounded-md border px-4 py-6 text-center">
                  Nothing matches removal thresholds right now.
                </div>
              ) : (
                <ScrollArea className="max-h-72 rounded-md border">
                  <ul className="divide-y">
                    {decisions.map((d, idx) => (
                      <li key={idx} className="px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium truncate">{d.torrentName}</div>
                          <Badge variant="destructive" className="shrink-0">remove</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{d.reason}</div>
                        {cleaner === 'queue' && (d as QueueDryRunDecision).linkedArrTitle && (
                          <div className="text-xs text-muted-foreground">
                            {(d as QueueDryRunDecision).linkedArrSource} · {(d as QueueDryRunDecision).linkedArrTitle}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
            </section>
          </div>
        )}

        <DialogFooter className="flex flex-row justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={confirming || loading || decisions.length === 0} variant="destructive">
            {confirming ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Confirm and remove {decisions.length > 0 ? `(${decisions.length})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
