'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FileUp, Link as LinkIcon, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function AddTorrentPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [addMode, setAddMode] = useState<'magnet' | 'file'>('magnet');
  const [magnetLink, setMagnetLink] = useState('');
  const [torrentFile, setTorrentFile] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);

  async function handleAddTorrent() {
    setAdding(true);
    try {
      if (addMode === 'magnet') {
        if (!magnetLink.trim()) {
          toast.error('Please enter a magnet link');
          return;
        }

        const res = await fetch('/api/qbittorrent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: magnetLink.trim() }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to add torrent');
        }
      } else {
        if (!torrentFile) {
          toast.error('Please select a .torrent file');
          return;
        }

        const formData = new FormData();
        formData.append('file', torrentFile);

        const res = await fetch('/api/qbittorrent', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to add torrent');
        }
      }

      toast.success('Torrent added');
      router.push('/torrents');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add torrent');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-4">
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
