'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Loader2 } from 'lucide-react';

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

export interface RunPreviewPendingStrike {
  torrentName: string;
  strikeType: string;
  ruleName: string | null;
  count: number;
  maxStrikes: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  loading: boolean;
  decisions: QueueDryRunDecision[] | DownloadDryRunDecision[];
  pendingStrikes?: RunPreviewPendingStrike[];
  onConfirm: () => void;
  confirming: boolean;
  cleaner: 'queue' | 'download';
}

export function RunPreviewDialog(props: Props) {
  const { open, onOpenChange, title, loading, decisions, pendingStrikes, onConfirm, confirming, cleaner } = props;

  // Identify destructive options for an extra warning banner.
  const hasDeleteSourceFiles = cleaner === 'download'
    && (decisions as DownloadDryRunDecision[]).some((d) => d.deleteSourceFiles);
  const hasDeletePrivate = cleaner === 'queue'
    && (decisions as QueueDryRunDecision[]).some((d) => d.options.deletePrivate);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85svh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="pr-8 truncate">{title}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="py-12 flex items-center justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Running dry-run…
          </div>
        ) : (
          <div className="space-y-4 flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
            {(hasDeleteSourceFiles || hasDeletePrivate) && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive-foreground/90 dark:text-destructive">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  {hasDeleteSourceFiles && <div>One or more rules will delete files from disk (not just remove from qBittorrent).</div>}
                  {hasDeletePrivate && <div>One or more rules will delete private torrents — this can affect your tracker H&amp;R standing.</div>}
                </div>
              </div>
            )}

            {pendingStrikes && pendingStrikes.length > 0 && (
              <section>
                <h3 className="text-sm font-medium mb-2">Strikes that would accumulate ({pendingStrikes.length})</h3>
                <div className="rounded-md border sm:max-h-48 sm:overflow-y-auto">
                  <ul className="divide-y">
                    {pendingStrikes.map((s, idx) => (
                      <li key={idx} className="px-3 py-2 text-sm flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{s.torrentName}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {s.strikeType}{s.ruleName ? ` · ${s.ruleName}` : ''}
                          </div>
                        </div>
                        <Badge variant="outline" className="shrink-0">{s.count}/{s.maxStrikes}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            <section>
              <h3 className="text-sm font-medium mb-2">Would be removed now ({decisions.length})</h3>
              {decisions.length === 0 ? (
                <div className="text-sm text-muted-foreground rounded-md border px-4 py-6 text-center">
                  Nothing matches removal thresholds right now.
                </div>
              ) : (
                <div className="rounded-md border sm:max-h-72 sm:overflow-y-auto">
                  <ul className="divide-y">
                    {decisions.map((d, idx) => (
                      <li key={idx} className="px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium truncate min-w-0 flex-1">{d.torrentName}</div>
                          <div className="flex items-center gap-1 shrink-0">
                            {cleaner === 'download' && (d as DownloadDryRunDecision).deleteSourceFiles && (
                              <Badge variant="destructive" className="text-[10px]">files</Badge>
                            )}
                            <Badge variant="destructive" className="shrink-0">remove</Badge>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{d.reason}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                          {cleaner === 'download' && (
                            <>
                              <span>rule: <span className="font-medium text-foreground/80">{(d as DownloadDryRunDecision).ruleName}</span></span>
                              <span>seeded {(d as DownloadDryRunDecision).seedingHours.toFixed(1)}h</span>
                              <span>ratio {(d as DownloadDryRunDecision).ratio.toFixed(2)}</span>
                            </>
                          )}
                          {cleaner === 'queue' && (d as QueueDryRunDecision).ruleName && (
                            <span>rule: <span className="font-medium text-foreground/80">{(d as QueueDryRunDecision).ruleName}</span></span>
                          )}
                          {cleaner === 'queue' && (d as QueueDryRunDecision).linkedArrTitle && (
                            <span className="break-words">{(d as QueueDryRunDecision).linkedArrSource}: {(d as QueueDryRunDecision).linkedArrTitle}</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>
        )}

        <DialogFooter className="flex flex-row flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={confirming || loading || decisions.length === 0}
            variant={decisions.length === 0 ? 'outline' : 'destructive'}
          >
            {confirming ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {decisions.length === 0 ? (
              'Nothing to remove'
            ) : (
              <>
                <span className="hidden sm:inline">Confirm and remove</span>
                <span className="sm:hidden">Remove</span>
                &nbsp;({decisions.length})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
