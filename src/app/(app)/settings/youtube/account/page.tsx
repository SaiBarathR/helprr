'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, FileUp, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import Link from '@/components/ui/app-link';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';

interface AccountStatus {
  set: boolean;
  valid: boolean | null;
  checkedAt: string | null;
}

const STEPS = [
  'Use a spare Google account, never your main one or a Premium one. YouTube can sign an account out for this.',
  'Open a private window and sign in to YouTube with it.',
  'Export the cookies for youtube.com with an extension such as Get cookies.txt LOCALLY.',
  'Close the private window without signing out, then add the file here.',
];

async function send(method: 'PUT' | 'DELETE', body?: unknown) {
  const res = await fetch('/api/youtube/cookies', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Could not save');
}

function statusText({ set, valid }: AccountStatus): { text: string; tone: string } {
  if (!set) return { text: 'Not added', tone: 'text-muted-foreground' };
  if (valid === false) return { text: 'Needs signing in again', tone: 'text-amber-400' };
  return valid ? { text: 'Working', tone: 'text-emerald-400' } : { text: 'Added, not used yet', tone: 'text-muted-foreground' };
}

export default function YoutubeAccountPage() {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const status = useQuery({
    queryKey: ['youtube', 'account'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/youtube/cookies', { signal });
      if (!res.ok) throw new Error('Could not load');
      return (await res.json()) as AccountStatus;
    },
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['youtube'] });

  const save = useMutation({
    mutationFn: async (file: File) => send('PUT', { cookies: await file.text() }),
    onSuccess: () => {
      toast.success('Account added');
      refresh();
    },
    onError: (error) => toast.error(error.message),
    onSettled: () => {
      if (input.current) input.current.value = '';
    },
  });
  const remove = useMutation({
    mutationFn: () => send('DELETE'),
    onSuccess: () => {
      toast.success('Account removed');
      setConfirmRemove(false);
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const data = status.data;
  const shown = data && statusText(data);
  return (
    <div className="animate-content-in">
      <div className="px-1 pb-2 pt-1">
        <Link href="/settings/youtube" className="-ml-1 inline-flex min-h-[44px] items-center gap-1 px-1 text-sm text-primary">
          <ChevronLeft className="h-5 w-5" />
          YouTube
        </Link>
      </div>
      <div className="mb-4 px-4">
        <h1 className="text-2xl font-bold">Spare account</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Only needed to save age-restricted videos. Every other video runs without it.</p>
      </div>

      {status.isError && <ErrorState message="Couldn't load the account" onRetry={() => void status.refetch()} />}
      {!data && !status.isError && <Skeleton className="mx-4 h-20 rounded-xl" />}
      {data && (
        <GroupedSection title="Account" footer="Helprr keeps this encrypted and never shows it again">
          <div className="grouped-row gap-3">
            <span className="text-sm">Status</span>
            <span className={`text-sm ${shown?.tone}`}>{shown?.text}</span>
          </div>
          <div className="space-y-2 px-4 py-3">
            <input
              ref={input}
              type="file"
              accept=".txt,text/plain"
              aria-label="cookies.txt file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) save.mutate(file);
              }}
            />
            <Button className="h-10 w-full rounded-full" disabled={save.isPending} onClick={() => input.current?.click()}>
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
              {data.set ? 'Replace cookies.txt' : 'Add cookies.txt'}
            </Button>
            {data.set && (
              <Button variant="secondary" className="h-10 w-full rounded-full text-destructive" onClick={() => setConfirmRemove(true)}>
                <Trash2 className="mr-2 h-4 w-4" />Remove the account
              </Button>
            )}
          </div>
        </GroupedSection>
      )}

      <GroupedSection title="How to get the file">
        <ol className="list-decimal space-y-2 py-3 pl-9 pr-4 text-sm text-muted-foreground">
          {STEPS.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </GroupedSection>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove the spare account?"
        description="Age-restricted videos will stop downloading until you add it again."
        confirmLabel="Remove"
        destructive
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
