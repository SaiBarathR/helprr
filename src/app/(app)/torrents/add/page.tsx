'use client';

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '@/lib/query-fetch';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FileUp, Link as LinkIcon, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ApiResult = {
  success?: boolean;
  error?: string;
};

async function parseApiResult(res: Response): Promise<ApiResult> {
  try {
    return await res.json() as ApiResult;
  } catch {
    return {};
  }
}

export default function AddTorrentPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [addMode, setAddMode] = useState<'magnet' | 'file'>('magnet');
  const [magnetLink, setMagnetLink] = useState('');
  const [torrentFile, setTorrentFile] = useState<File | null>(null);

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = addMode === 'magnet'
        ? await fetch('/api/qbittorrent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: magnetLink.trim() }),
          })
        : await (() => {
            const formData = new FormData();
            formData.append('file', torrentFile as File);
            return fetch('/api/qbittorrent', { method: 'POST', body: formData });
          })();

      const data = await parseApiResult(res);
      // ApiError carries the status so a 401 reaches the global MutationCache
      // handler (redirect); a 200 with success:false toasts as a normal failure.
      if (!res.ok || data.error || data.success !== true) {
        throw new ApiError(res.status, data.error || 'Failed to add torrent');
      }
    },
    onSuccess: () => {
      toast.success('Torrent added');
      router.push('/torrents');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Failed to add torrent');
    },
  });
  const adding = addMutation.isPending;

  function handleAddTorrent() {
    if (addMode === 'magnet' && !magnetLink.trim()) {
      toast.error('Please enter a magnet link');
      return;
    }
    if (addMode === 'file' && !torrentFile) {
      toast.error('Please select a .torrent file');
      return;
    }
    addMutation.mutate();
  }

  return (
    <div className="space-y-4 animate-content-in">
      <PageHeader title="Add Torrent" />

      <div className="rounded-xl border bg-card p-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Add a torrent via magnet link or .torrent file.
        </p>

        <div className="flex gap-2">
          <Button
            variant={addMode === 'magnet' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAddMode('magnet')}
            className="flex-1"
          >
            <LinkIcon className="mr-2 h-4 w-4" />
            Magnet Link
          </Button>
          <Button
            variant={addMode === 'file' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAddMode('file')}
            className="flex-1"
          >
            <FileUp className="mr-2 h-4 w-4" />
            Torrent File
          </Button>
        </div>

        {addMode === 'magnet' ? (
          <Input
            placeholder="magnet:?xt=urn:btih:..."
            value={magnetLink}
            onChange={(e) => setMagnetLink(e.target.value)}
            autoFocus
          />
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".torrent"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setTorrentFile(file);
              }}
            />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp className="mr-2 h-4 w-4" />
              {torrentFile ? torrentFile.name : 'Choose .torrent file'}
            </Button>
          </>
        )}

        <div className="flex gap-2 pt-2">
          <Button onClick={handleAddTorrent} disabled={adding} className="flex-1">
            {adding ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              'Add Torrent'
            )}
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => router.push('/torrents')}
            disabled={adding}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
