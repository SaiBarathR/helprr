'use client';

import { useRef, useState } from 'react';
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

        const data = await parseApiResult(res);
        if (!res.ok || data.error || data.success !== true) {
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

        const data = await parseApiResult(res);
        if (!res.ok || data.error || data.success !== true) {
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
    <div className="space-y-5 animate-content-in">
      <PageHeader title="Add Torrent" subtitle="qBittorrent" />

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="reel" aria-hidden />
          <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
            New Torrent
          </h2>
          <span className="hairline flex-1" aria-hidden />
        </div>
        <p className="text-[12.5px] text-muted-foreground/85 pl-1">
          Add a torrent via magnet link or <span className="font-mono tabular text-[color:var(--amber)]">.torrent</span> file.
        </p>
      </div>

      <div className="space-y-4">
        {/* Editorial mode tabs */}
        <div className="flex items-center gap-0.5 sm:gap-1">
          {([
            { mode: 'magnet' as const, label: 'Magnet Link', icon: LinkIcon },
            { mode: 'file' as const, label: 'Torrent File', icon: FileUp },
          ]).map(({ mode, label, icon: Icon }) => {
            const active = addMode === mode;
            return (
              <button
                key={mode}
                onClick={() => setAddMode(mode)}
                className={`relative flex-1 px-3 py-2 inline-flex items-center justify-center gap-2 transition-colors ${
                  active ? 'text-foreground' : 'text-muted-foreground/70 hover:text-foreground'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${active ? 'text-[color:var(--amber)]' : ''}`} />
                <span className="font-display text-[14px]" style={{ letterSpacing: '-0.01em' }}>
                  {label}
                </span>
                <span
                  aria-hidden
                  className={`absolute left-2 right-2 -bottom-px h-px transition-all ${
                    active ? 'bg-[color:var(--amber)] opacity-100' : 'bg-foreground/20 opacity-0'
                  }`}
                />
              </button>
            );
          })}
        </div>
        <div className="hairline" aria-hidden />

        {addMode === 'magnet' ? (
          <div className="space-y-2">
            <label className="tracked-caps text-[9px] text-muted-foreground/85 block" style={{ letterSpacing: '0.24em' }}>
              Magnet URI
            </label>
            <Input
              placeholder="magnet:?xt=urn:btih:..."
              value={magnetLink}
              onChange={(e) => setMagnetLink(e.target.value)}
              className="font-mono tabular text-[12px]"
              autoFocus
            />
          </div>
        ) : (
          <div className="space-y-2">
            <label className="tracked-caps text-[9px] text-muted-foreground/85 block" style={{ letterSpacing: '0.24em' }}>
              Torrent File
            </label>
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
            <button
              onClick={() => fileInputRef.current?.click()}
              className="press-feedback w-full px-4 py-6 border border-dashed border-[color:var(--hairline)] hover:border-[color:var(--amber-soft)] bg-card/40 hover:bg-card/70 transition-all flex flex-col items-center gap-2"
              style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
            >
              <FileUp className="h-5 w-5 text-[color:var(--amber)]" />
              {torrentFile ? (
                <p className="font-mono tabular text-[12px] truncate max-w-full">{torrentFile.name}</p>
              ) : (
                <p className="tracked-caps text-[10px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
                  Choose .torrent file
                </p>
              )}
            </button>
          </div>
        )}

        <div className="flex gap-2 pt-3">
          <Button
            variant="outline"
            className="flex-1 h-11"
            onClick={() => router.push('/torrents')}
            disabled={adding}
          >
            <span className="tracked-caps text-[10px]">Cancel</span>
          </Button>
          <Button onClick={handleAddTorrent} disabled={adding} className="flex-1 h-11 cta-sheen projector-glow">
            {adding ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="tracked-caps text-[10px]">Adding…</span>
              </>
            ) : (
              <span className="tracked-caps text-[10px]">Add Torrent</span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
