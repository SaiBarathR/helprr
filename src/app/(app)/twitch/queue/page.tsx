'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TwitchSubNav } from '@/components/twitch/twitch-subnav';
import { backoffRefetchInterval } from '@/lib/query-fetch';

interface Job {
  id: string;
  state: string;
  stage: string | null;
  progress: number | null;
  bytesDone: number | null;
  bytesTotal: number | null;
  errorClass: string | null;
  lastError: string | null;
  video: { title: string; streamer: { displayName: string } } | null;
}

interface WorkerStatus {
  online: boolean;
  seen: boolean;
  tools?: { ytdlp?: string | null; td?: string | null };
  gpuAvailable?: boolean;
  diskFreeBytes?: number | null;
}

const ACTIVE = new Set(['RUNNING']);
const WAITING = new Set(['QUEUED', 'RETRY_WAIT', 'BLOCKED']);
const DONE_SHOWN = 20;

const STATE_LABELS: Record<string, string> = {
  QUEUED: 'Queued',
  RETRY_WAIT: 'Waiting to retry',
  BLOCKED: 'Blocked: not enough disk space',
};

const ERROR_LABELS: Record<string, string> = {
  auth: 'Twitch refused access',
  subOnly: 'Subscribers only',
  gone: 'The video is gone',
  validation: 'The file failed its checks',
  extractor: 'Twitch changed something the download tool relies on',
  transient: 'Network or Twitch error',
  disk: 'Not enough disk space',
};

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function JobRow({ job, action, onAction, busy }: {
  job: Job;
  action: 'cancel' | 'retry' | null;
  onAction?: () => void;
  busy: boolean;
}) {
  const progress = job.progress === null ? null : Math.round(job.progress * 100);
  const detail = job.state === 'RUNNING'
    ? [job.stage ?? 'Starting', progress === null ? null : `${progress}%`, job.bytesTotal ? gb(job.bytesTotal) : null].filter(Boolean).join(' · ')
    : job.state === 'FAILED'
      ? ERROR_LABELS[job.errorClass ?? ''] ?? 'Failed'
      : STATE_LABELS[job.state] ?? job.state.toLowerCase();
  return (
    <div className="grouped-row">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{job.video?.title ?? 'Video'}</p>
        <p className="truncate text-xs text-muted-foreground">{job.video?.streamer.displayName} · {detail}</p>
        {job.state === 'RUNNING' && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${progress ?? 0}%` }} />
          </div>
        )}
      </div>
      {action && (
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0"
          disabled={busy}
          aria-label={action === 'cancel' ? 'Cancel download' : 'Retry download'}
          onClick={onAction}
        >
          {action === 'cancel' ? <X className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
        </Button>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grouped-section">
      <div className="grouped-section-title">{title}</div>
      <div className="grouped-section-content">{children}</div>
    </section>
  );
}

export default function TwitchQueuePage() {
  const queryClient = useQueryClient();
  const [link, setLink] = useState('');

  const jobsQuery = useQuery({
    queryKey: ['twitch', 'jobs'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/twitch/jobs', { signal });
      if (!res.ok) throw new Error('Failed to load the queue');
      return (await res.json()) as { jobs: Job[] };
    },
    refetchInterval: (query) => {
      const anyActive = query.state.data?.jobs.some((job) => ACTIVE.has(job.state) || WAITING.has(job.state));
      return anyActive ? backoffRefetchInterval(2_000)(query) : 15_000;
    },
    refetchIntervalInBackground: false,
  });
  const jobs = jobsQuery.data?.jobs ?? [];

  const workerQuery = useQuery({
    queryKey: ['twitch', 'worker'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/twitch/worker', { signal });
      if (!res.ok) throw new Error('Failed to load the worker');
      return (await res.json()) as WorkerStatus;
    },
    refetchInterval: backoffRefetchInterval(15_000),
    refetchIntervalInBackground: false,
  });
  const worker = workerQuery.data;

  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'cancel' | 'retry' }) => {
      const res = await fetch(`/api/twitch/jobs/${id}/${action}`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Could not ${action}`);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['twitch', 'jobs'] }),
    onError: (error) => toast.error(error.message),
  });

  const paste = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/twitch/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: link.trim(), clientRequestId: crypto.randomUUID() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not queue that link');
    },
    onSuccess: () => {
      setLink('');
      toast.success('Download queued');
      void queryClient.invalidateQueries({ queryKey: ['twitch'] });
    },
    onError: (error) => toast.error(error.message),
  });

  const active = jobs.filter((job) => ACTIVE.has(job.state));
  const waiting = jobs.filter((job) => WAITING.has(job.state));
  const failed = jobs.filter((job) => job.state === 'FAILED');
  const done = jobs.filter((job) => job.state === 'DONE').slice(0, DONE_SHOWN);

  return (
    <div className="animate-content-in pb-8">
      <PageHeader title="Queue" showBack={false} rightContent={<TwitchSubNav active="queue" />} />
      <div className="space-y-4 px-4 pt-2">
        <Section title="Worker">
          <div className="grouped-row">
            <span className="flex items-center gap-2 text-sm">
              <span className={`h-2 w-2 rounded-full ${worker?.online ? 'bg-emerald-500' : 'bg-red-500'}`} />
              {worker?.online ? 'Online' : worker?.seen ? 'Offline' : 'Not started'}
            </span>
            {worker?.diskFreeBytes != null && (
              <span className="text-xs text-muted-foreground">{gb(worker.diskFreeBytes)} free</span>
            )}
          </div>
          {worker?.tools?.ytdlp && (
            <div className="grouped-row">
              <span className="text-sm text-muted-foreground">Tools</span>
              <span className="truncate font-mono text-xs text-muted-foreground">yt-dlp {worker.tools.ytdlp} · TD {worker.tools.td}</span>
            </div>
          )}
        </Section>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (link.trim()) paste.mutate();
          }}
        >
          <Input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="Paste a Twitch video link"
            aria-label="Twitch video link"
            autoCapitalize="none"
            autoCorrect="off"
            className="h-10"
          />
          <Button type="submit" className="h-10 shrink-0" disabled={!link.trim() || paste.isPending}>
            {paste.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Queue'}
          </Button>
        </form>

        {active.length > 0 && (
          <Section title="Downloading">
            {active.map((job) => (
              <JobRow key={job.id} job={job} action="cancel" busy={act.isPending} onAction={() => act.mutate({ id: job.id, action: 'cancel' })} />
            ))}
          </Section>
        )}
        {waiting.length > 0 && (
          <Section title="Waiting">
            {waiting.map((job) => (
              <JobRow key={job.id} job={job} action="cancel" busy={act.isPending} onAction={() => act.mutate({ id: job.id, action: 'cancel' })} />
            ))}
          </Section>
        )}
        {failed.length > 0 && (
          <Section title="Failed">
            {failed.map((job) => (
              <JobRow key={job.id} job={job} action="retry" busy={act.isPending} onAction={() => act.mutate({ id: job.id, action: 'retry' })} />
            ))}
          </Section>
        )}
        {done.length > 0 && (
          <Section title="Done">
            {done.map((job) => <JobRow key={job.id} job={job} action={null} busy={false} />)}
          </Section>
        )}
        {jobsQuery.isSuccess && jobs.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">Queue is empty.</p>
        )}
      </div>
    </div>
  );
}
