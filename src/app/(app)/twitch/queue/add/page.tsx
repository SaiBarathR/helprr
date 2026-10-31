'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Text fields live on a page, not in a drawer: the iOS keyboard pushes a drawer out of view.
export default function AddTwitchVideoPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [link, setLink] = useState('');
  // One id per page, so a double tap cannot queue the video twice.
  const clientRequestId = useMemo(() => crypto.randomUUID(), []);

  const queue = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/twitch/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: link.trim(), clientRequestId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not queue that link');
    },
    onSuccess: () => {
      toast.success('Download queued');
      void queryClient.invalidateQueries({ queryKey: ['twitch'] });
      router.push('/twitch/queue');
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="animate-content-in">
      <PageHeader title="Download a video" backHref="/twitch/queue" />
      <form
        className="space-y-3 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (link.trim()) queue.mutate();
        }}
      >
        <Input
          autoFocus
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="Paste a Twitch video link"
          aria-label="Twitch video link"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <p className="px-1 text-xs text-muted-foreground">Any public video works, even from a streamer you do not follow.</p>
        <Button type="submit" className="h-10 w-full rounded-full" disabled={!link.trim() || queue.isPending}>
          {queue.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Download
        </Button>
      </form>
    </div>
  );
}
