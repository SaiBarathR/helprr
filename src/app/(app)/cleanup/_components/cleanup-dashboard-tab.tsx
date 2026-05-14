'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, AlertTriangle } from 'lucide-react';
import { RunPreviewDialog, QueueDryRunDecision, DownloadDryRunDecision } from './run-preview-dialog';

interface Stats {
  removedToday: number;
  removedThisWeek: number;
  removedAllTime: number;
  queueTotal: number;
  downloadTotal: number;
  activeStrikes: number;
}

interface StrikeRow {
  id: string;
  hash: string;
  torrentName: string;
  strikeType: string;
  ruleId: string | null;
  ruleName: string | null;
  count: number;
  maxStrikes: number;
  lastSeenAt: string;
}

export function CleanupDashboardTab({ onNavigate }: { onNavigate: (target: 'queue' | 'download' | 'history') => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [strikes, setStrikes] = useState<StrikeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [queuePreview, setQueuePreview] = useState<{
    open: boolean;
    loading: boolean;
    decisions: QueueDryRunDecision[];
    pendingStrikes: { torrentName: string; strikeType: string; ruleName: string | null; count: number; maxStrikes: number }[];
    confirming: boolean;
  }>({ open: false, loading: false, decisions: [], pendingStrikes: [], confirming: false });

  const [downloadPreview, setDownloadPreview] = useState<{
    open: boolean;
    loading: boolean;
    decisions: DownloadDryRunDecision[];
    confirming: boolean;
  }>({ open: false, loading: false, decisions: [], confirming: false });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, strikesRes] = await Promise.all([
        fetch('/api/cleanup/stats').then((r) => r.json()),
        fetch('/api/cleanup/strikes').then((r) => r.json()),
      ]);
      setStats(statsRes);
      setStrikes(strikesRes);
    } catch {
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const startQueueDryRun = async () => {
    setQueuePreview({ open: true, loading: true, decisions: [], pendingStrikes: [], confirming: false });
    try {
      const r = await fetch('/api/cleanup/queue/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      const json = await r.json();
      setQueuePreview({ open: true, loading: false, decisions: json.decisions ?? [], pendingStrikes: json.pendingStrikes ?? [], confirming: false });
    } catch {
      toast.error('Queue dry-run failed');
      setQueuePreview({ open: false, loading: false, decisions: [], pendingStrikes: [], confirming: false });
    }
  };

  const confirmQueueRun = async () => {
    setQueuePreview((p) => ({ ...p, confirming: true }));
    try {
      const r = await fetch('/api/cleanup/queue/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      });
      const json = await r.json();
      toast.success(`Removed ${json.decisions?.length ?? 0} torrent(s)`);
      setQueuePreview({ open: false, loading: false, decisions: [], pendingStrikes: [], confirming: false });
      refresh();
    } catch {
      toast.error('Queue run failed');
      setQueuePreview((p) => ({ ...p, confirming: false }));
    }
  };

  const startDownloadDryRun = async () => {
    setDownloadPreview({ open: true, loading: true, decisions: [], confirming: false });
    try {
      const r = await fetch('/api/cleanup/download/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      const json = await r.json();
      setDownloadPreview({ open: true, loading: false, decisions: json.decisions ?? [], confirming: false });
    } catch {
      toast.error('Download dry-run failed');
      setDownloadPreview({ open: false, loading: false, decisions: [], confirming: false });
    }
  };

  const confirmDownloadRun = async () => {
    setDownloadPreview((p) => ({ ...p, confirming: true }));
    try {
      const r = await fetch('/api/cleanup/download/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      });
      const json = await r.json();
      toast.success(`Removed ${json.decisions?.length ?? 0} torrent(s)`);
      setDownloadPreview({ open: false, loading: false, decisions: [], confirming: false });
      refresh();
    } catch {
      toast.error('Download run failed');
      setDownloadPreview((p) => ({ ...p, confirming: false }));
    }
  };

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Removed today" value={stats?.removedToday ?? '—'} loading={loading} />
        <StatCard label="Past 7 days" value={stats?.removedThisWeek ?? '—'} loading={loading} />
        <StatCard label="All time" value={stats?.removedAllTime ?? '—'} loading={loading} />
        <StatCard label="Active strikes" value={stats?.activeStrikes ?? '—'} loading={loading} />
      </section>

      <section className="grouped-section">
        <div className="grouped-section-title">Quick actions</div>
        <div className="grouped-section-content">
          <div className="grouped-row">
            <div className="min-w-0">
              <div className="font-medium">Run Queue Cleaner now</div>
              <div className="text-xs text-muted-foreground">Preview decisions in a dialog before applying.</div>
            </div>
            <Button size="sm" onClick={startQueueDryRun}>
              <Play className="w-4 h-4 mr-1" /> Preview
            </Button>
          </div>
          <div className="grouped-row">
            <div className="min-w-0">
              <div className="font-medium">Run Download Cleaner now</div>
              <div className="text-xs text-muted-foreground">Preview decisions in a dialog before applying.</div>
            </div>
            <Button size="sm" onClick={startDownloadDryRun}>
              <Play className="w-4 h-4 mr-1" /> Preview
            </Button>
          </div>
          <div className="grouped-row">
            <div className="min-w-0">
              <div className="font-medium">Configure rules</div>
              <div className="text-xs text-muted-foreground">Open the Queue or Download cleaner tabs.</div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => onNavigate('queue')}>Queue</Button>
              <Button variant="ghost" size="sm" onClick={() => onNavigate('download')}>Download</Button>
            </div>
          </div>
        </div>
      </section>

      <section className="grouped-section">
        <div className="grouped-section-title flex items-center justify-between">
          <span>Active strikes ({strikes.length})</span>
          {strikes.length > 0 && (
            <button
              type="button"
              className="text-xs underline text-muted-foreground"
              onClick={() => onNavigate('history')}
            >
              View history
            </button>
          )}
        </div>
        <div className="grouped-section-content">
          {loading ? (
            <div className="grouped-row text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
          ) : strikes.length === 0 ? (
            <div className="grouped-row text-sm text-muted-foreground">No strikes currently accumulated.</div>
          ) : (
            strikes.map((s) => (
              <div key={s.id} className="grouped-row">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate" title={s.torrentName}>{s.torrentName}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.strikeType}{s.ruleName ? ` · ${s.ruleName}` : ''} · {new Date(s.lastSeenAt).toLocaleString()}
                  </div>
                </div>
                <Badge
                  variant={s.count >= s.maxStrikes ? 'destructive' : 'outline'}
                  className="shrink-0 font-mono"
                >
                  {s.count}/{s.maxStrikes}
                </Badge>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="text-xs text-muted-foreground flex items-start gap-2 px-1">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Cleaners only act on torrents managed in qBittorrent. Make sure qBittorrent (and optionally Sonarr/Radarr) are configured in Settings.
        </span>
      </div>

      <RunPreviewDialog
        cleaner="queue"
        title="Queue Cleaner — dry-run preview"
        open={queuePreview.open}
        onOpenChange={(o) => setQueuePreview((p) => ({ ...p, open: o }))}
        loading={queuePreview.loading}
        decisions={queuePreview.decisions}
        pendingStrikes={queuePreview.pendingStrikes}
        onConfirm={confirmQueueRun}
        confirming={queuePreview.confirming}
      />
      <RunPreviewDialog
        cleaner="download"
        title="Download Cleaner — dry-run preview"
        open={downloadPreview.open}
        onOpenChange={(o) => setDownloadPreview((p) => ({ ...p, open: o }))}
        loading={downloadPreview.loading}
        decisions={downloadPreview.decisions}
        onConfirm={confirmDownloadRun}
        confirming={downloadPreview.confirming}
      />
    </div>
  );
}

function StatCard({ label, value, loading }: { label: string; value: number | string; loading: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-mono">{loading ? '—' : value}</div>
    </div>
  );
}
