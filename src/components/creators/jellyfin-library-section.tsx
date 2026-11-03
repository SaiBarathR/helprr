'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface LibraryStatus {
  configured?: boolean;
  path?: string;
  exists?: boolean;
  name?: string | null;
  fetchersOff?: boolean;
  conflicts?: string[];
  error?: string;
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || fallback);
  return data as T;
}

export function JellyfinLibrarySection({ platform, defaultName }: { platform: 'twitch' | 'youtube'; defaultName: string }) {
  const url = `/api/${platform}/library`;
  const queryClient = useQueryClient();
  const library = useQuery({
    queryKey: [platform, 'library'],
    queryFn: async ({ signal }) => readJson<LibraryStatus>(await fetch(url, { signal }), 'Could not load'),
    retry: false,
  });
  const [name, setName] = useState(defaultName);
  const [typedPath, setTypedPath] = useState<string | null>(null);
  const path = typedPath ?? library.data?.path ?? '';

  const createLibrary = useMutation({
    mutationFn: async () => readJson(await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path }),
    }), 'Could not save'),
    onSuccess: () => {
      toast.success('Library is ready');
      void queryClient.invalidateQueries({ queryKey: [platform] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const status = library.data;
  return (
    <GroupedSection
      title="Jellyfin library"
      footer={status?.exists ? 'Exclude this library from the Intro Skipper plugin, if you use it' : 'Creating a library changes your real Jellyfin'}
    >
      {status?.exists ? (
        <>
          <div className="grouped-row gap-3"><span className="text-sm">Library</span><span className="truncate text-sm text-muted-foreground">{status.name}</span></div>
          <div className="grouped-row gap-3">
            <span className="text-sm">Internet metadata</span>
            <span className={cn('text-sm', status.fetchersOff ? 'text-muted-foreground' : 'text-amber-400')}>{status.fetchersOff ? 'Off' : 'On: turn it off'}</span>
          </div>
        </>
      ) : (
        <div className="space-y-2 px-4 py-3">
          {status?.conflicts?.length ? (
            <p className="text-sm text-amber-400">Already covered by {status.conflicts.join(', ')}.</p>
          ) : null}
          <Input aria-label="Library name" value={name} onChange={(event) => setName(event.target.value)} />
          <Input
            aria-label="Library path, as Jellyfin sees it"
            placeholder="Path, as Jellyfin sees it"
            value={path}
            onChange={(event) => setTypedPath(event.target.value)}
          />
          <Button className="h-10 w-full rounded-full" disabled={!path.trim() || createLibrary.isPending} onClick={() => createLibrary.mutate()}>
            Create library
          </Button>
        </div>
      )}
    </GroupedSection>
  );
}
