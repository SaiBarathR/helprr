'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ChevronDown,
  ChevronRight,
  File,
  FileUp,
  Folder,
  Link as LinkIcon,
  Loader2,
  Search,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatBytes } from '@/lib/format';
import { useCan } from '@/components/permission-provider';
import type { TorrentFile } from '@/lib/qbittorrent-client';
import {
  buildFileTree,
  getAllFileIndices,
  getCheckState,
  type TreeNode,
  type DirNode,
  type FileNode,
} from '@/lib/torrent-file-tree';

type ApiResult = {
  success?: boolean;
  error?: string;
  hash?: string;
};

const NO_CATEGORY = '__none__';

async function parseApiResult(res: Response): Promise<ApiResult> {
  try {
    return await res.json() as ApiResult;
  } catch {
    return {};
  }
}

function magnetDisplayName(link: string): string | null {
  const queryStart = link.indexOf('?');
  if (queryStart < 0) return null;
  return new URLSearchParams(link.slice(queryStart + 1)).get('dn');
}

export default function AddTorrentPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [addMode, setAddMode] = useState<'magnet' | 'file'>('magnet');
  const [magnetLink, setMagnetLink] = useState('');
  const [torrentFile, setTorrentFile] = useState<File | null>(null);
  const [savePath, setSavePath] = useState('');
  const [category, setCategory] = useState(NO_CATEGORY);
  const [startTorrent, setStartTorrent] = useState(true);

  // Review step: set once the torrent is added stopped and files can be picked.
  const [reviewHash, setReviewHash] = useState<string | null>(null);

  // File selection review needs torrents.manage (file priorities + start) AND
  // torrents.delete (Cancel removes the added-stopped torrent). Without both,
  // only the previous direct-add behavior is offered.
  const canManage = useCan('torrents.manage');
  const canDelete = useCan('torrents.delete');
  const canReview = canManage && canDelete;

  const categoriesQuery = useQuery({
    queryKey: ['qbittorrent', 'categories'],
    queryFn: jsonFetcher<Record<string, { name: string; savePath: string }>>('/api/qbittorrent/categories'),
    staleTime: 60_000,
  });
  const categories = useMemo(
    () => Object.values(categoriesQuery.data ?? {}),
    [categoriesQuery.data],
  );
  const selectedCategory = category === NO_CATEGORY ? undefined : category;
  const categorySavePath = categories.find((c) => c.name === selectedCategory)?.savePath;

  const addMutation = useMutation({
    mutationFn: async ({ review }: { review: boolean }) => {
      // With review, add .torrent files stopped so files can be deselected
      // before any data downloads. Magnets can't fetch metadata while stopped,
      // so they start with stopCondition=MetadataReceived: qBittorrent stops
      // them automatically once metadata arrives, before downloading data.
      // Direct add skips review and just honors the "Start torrent" checkbox.
      const paused = review ? addMode === 'file' : !startTorrent;

      const res = addMode === 'magnet'
        ? await fetch('/api/qbittorrent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              urls: magnetLink.trim(),
              category: selectedCategory,
              savepath: savePath.trim() || undefined,
              paused,
              stopCondition: review ? 'MetadataReceived' : undefined,
            }),
          })
        : await (() => {
            const formData = new FormData();
            formData.append('file', torrentFile as File);
            if (selectedCategory) formData.append('category', selectedCategory);
            if (savePath.trim()) formData.append('savepath', savePath.trim());
            formData.append('paused', String(paused));
            return fetch('/api/qbittorrent', { method: 'POST', body: formData });
          })();

      const data = await parseApiResult(res);
      // ApiError carries the status so a 401 reaches the global MutationCache
      // handler (redirect); a 200 with success:false toasts as a normal failure.
      if (!res.ok || data.error || data.success !== true) {
        throw new ApiError(res.status, data.error || 'Failed to add torrent');
      }
      return data;
    },
    onSuccess: (data, { review }) => {
      if (review) {
        if (data.hash) {
          setReviewHash(data.hash);
          return;
        }
        // The torrent was added (stopped) but the API returned no hash, so the
        // file-selection step can't run — say so instead of pretending the
        // direct add path was taken.
        toast.warning('Torrent added stopped, but file selection was unavailable');
        router.push('/torrents');
        return;
      }
      toast.success('Torrent added');
      router.push('/torrents');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Failed to add torrent');
    },
  });
  const adding = addMutation.isPending;

  function handleAddTorrent(review: boolean) {
    if (addMode === 'magnet' && !magnetLink.trim()) {
      toast.error('Please enter a magnet link');
      return;
    }
    if (addMode === 'file' && !torrentFile) {
      toast.error('Please select a .torrent file');
      return;
    }
    addMutation.mutate({ review });
  }

  if (reviewHash) {
    const displayName =
      (addMode === 'magnet'
        ? magnetDisplayName(magnetLink)
        : torrentFile?.name.replace(/\.torrent$/i, '')) || 'New Torrent';
    return (
      <ReviewStep
        hash={reviewHash}
        displayName={displayName}
        startTorrent={startTorrent}
        stopOnMetadata={addMode === 'magnet'}
      />
    );
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

        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="save-path">
              Save at
            </label>
            <Input
              id="save-path"
              placeholder={categorySavePath || 'qBittorrent default'}
              value={savePath}
              onChange={(e) => setSavePath(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="category">
              Category
            </label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>None</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={startTorrent}
              onChange={(e) => setStartTorrent(e.target.checked)}
              className="rounded border-border h-4 w-4"
            />
            <span className="text-sm">Start torrent</span>
          </label>
        </div>

        <div className="space-y-2 pt-2">
          {canReview && (
            <Button
              onClick={() => handleAddTorrent(true)}
              disabled={adding}
              className="w-full"
            >
              {adding && addMutation.variables?.review ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                'Next: Choose Files'
              )}
            </Button>
          )}
          <div className="flex gap-2">
            <Button
              variant={canReview ? 'outline' : 'default'}
              onClick={() => handleAddTorrent(false)}
              disabled={adding}
              className="flex-1"
            >
              {adding && !addMutation.variables?.review ? (
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
    </div>
  );
}

function ReviewStep({
  hash,
  displayName,
  startTorrent,
  stopOnMetadata,
}: {
  hash: string;
  displayName: string;
  startTorrent: boolean;
  stopOnMetadata: boolean;
}) {
  const router = useRouter();
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  // null = untouched; top-level folders render expanded by default.
  const [expandedDirs, setExpandedDirs] = useState<Set<string> | null>(null);
  const [fileFilter, setFileFilter] = useState('');

  // Poll for files until metadata arrives (magnets fetch metadata even while
  // stopped); once the file list exists it's static, so polling stops.
  const filesQuery = useQuery({
    queryKey: ['qbittorrent', hash, 'add-review-files'],
    queryFn: jsonFetcher<{ files: TorrentFile[] }>(`/api/qbittorrent/${hash}/files`),
    select: (d) => d.files ?? [],
    refetchInterval: (query) => ((query.state.data?.files?.length ?? 0) > 0 ? false : 1500),
    refetchIntervalInBackground: false,
  });
  const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);
  const hasMetadata = files.length > 0;

  // Magnets fetch metadata while running (stopped torrents can't). qBittorrent
  // 4.6+ auto-stops via stopCondition=MetadataReceived; this covers older
  // versions by stopping as soon as the file list first appears. The request
  // promise is kept so confirm can await it — otherwise a late-landing stop
  // could re-stop a torrent the user just started.
  const stopPendingRef = useRef(stopOnMetadata);
  const stopRequestRef = useRef<Promise<void> | null>(null);
  useEffect(() => {
    if (!hasMetadata || !stopPendingRef.current) return;
    stopPendingRef.current = false;
    stopRequestRef.current = fetch(`/api/qbittorrent/${hash}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    }).then(
      () => undefined,
      () => undefined, // best effort — confirm still applies priorities
    );
  }, [hasMetadata, hash]);

  const defaultExpandedDirs = useMemo(() => {
    const roots = new Set<string>();
    for (const f of files) {
      const slash = f.name.indexOf('/');
      if (slash > 0) roots.add(f.name.slice(0, slash));
    }
    return roots;
  }, [files]);
  const effectiveExpandedDirs = expandedDirs ?? defaultExpandedDirs;

  const filterText = fileFilter.trim().toLowerCase();
  const tree = useMemo(() => {
    const visible = filterText
      ? files.filter((f) => f.name.toLowerCase().includes(filterText))
      : files;
    // Reuse the shared tree helpers by expressing local selection as priority.
    return buildFileTree(
      visible.map((f) => ({ ...f, priority: excluded.has(f.index) ? 0 : 1 })),
    );
  }, [files, excluded, filterText]);

  const selectedCount = files.length - excluded.size;
  const selectedSize = useMemo(
    () => files.reduce((sum, f) => (excluded.has(f.index) ? sum : sum + f.size), 0),
    [files, excluded],
  );

  const setSelected = useCallback((indices: number[], selected: boolean) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const index of indices) {
        if (selected) next.delete(index);
        else next.add(index);
      }
      return next;
    });
  }, []);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev ?? defaultExpandedDirs);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, [defaultExpandedDirs]);

  const confirmMutation = useMutation({
    mutationFn: async () => {
      // Let the fallback stop settle first so it can't land after our start.
      if (stopRequestRef.current) await stopRequestRef.current;
      if (excluded.size > 0) {
        const res = await fetch(`/api/qbittorrent/${hash}/files/priority`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [...excluded], priority: 0 }),
        });
        if (!res.ok) {
          const data = await parseApiResult(res);
          throw new ApiError(res.status, data.error || 'Failed to skip deselected files');
        }
      }
      if (startTorrent) {
        const res = await fetch(`/api/qbittorrent/${hash}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start' }),
        });
        if (!res.ok) {
          const data = await parseApiResult(res);
          throw new ApiError(res.status, data.error || 'Failed to start torrent');
        }
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

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/qbittorrent/${hash}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', deleteFiles: false }),
      });
      if (!res.ok) {
        const data = await parseApiResult(res);
        throw new ApiError(res.status, data.error || 'Failed to remove torrent');
      }
    },
    onSuccess: () => {
      toast.success('Torrent removed');
      router.push('/torrents');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Failed to remove torrent');
    },
  });

  const busy = confirmMutation.isPending || cancelMutation.isPending;

  return (
    <div className="space-y-3 animate-content-in">
      <PageHeader title="Choose Files" subtitle={displayName} showBack={false} />

      {!hasMetadata ? (
        <div className="rounded-xl border bg-card p-8 flex flex-col items-center gap-3 text-center">
          {filesQuery.isError ? (
            <p className="text-sm text-muted-foreground">
              {filesQuery.error instanceof Error ? filesQuery.error.message : 'Failed to fetch files'}
            </p>
          ) : (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Retrieving metadata from peers…</p>
              <p className="text-xs text-muted-foreground">
                The torrent stops once metadata arrives so you can pick files before downloading.
              </p>
            </>
          )}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => cancelMutation.mutate()}
            disabled={busy}
          >
            {cancelMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cancel
          </Button>
        </div>
      ) : (
        <>
          {/* Selection summary + bulk controls */}
          <div className="rounded-xl bg-card p-3 space-y-2.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {selectedCount} of {files.length} file{files.length !== 1 ? 's' : ''} selected
              </span>
              <span>{formatBytes(selectedSize)}</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setExcluded(new Set())}
              >
                Select All
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setExcluded(new Set(files.map((f) => f.index)))}
              >
                Select None
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Filter files..."
                value={fileFilter}
                onChange={(e) => setFileFilter(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>

          {/* File tree */}
          <div className="rounded-xl bg-card overflow-hidden">
            {tree.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">No files match the filter</p>
            ) : (
              tree.map((node) => (
                <ReviewNodeRow
                  key={node.type === 'file' ? `f-${node.file.index}` : `d-${node.path}`}
                  node={node}
                  depth={0}
                  expandedDirs={effectiveExpandedDirs}
                  forceExpand={filterText.length > 0}
                  onToggleDir={toggleDir}
                  onSetSelected={setSelected}
                />
              ))
            )}
          </div>

          <div className="flex gap-2 pb-4">
            <Button
              className="flex-1"
              onClick={() => confirmMutation.mutate()}
              disabled={busy || selectedCount === 0}
            >
              {confirmMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : startTorrent ? (
                'Add & Start'
              ) : (
                'Add Stopped'
              )}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => cancelMutation.mutate()}
              disabled={busy}
            >
              {cancelMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

interface ReviewNodeRowProps {
  node: TreeNode;
  depth: number;
  expandedDirs: Set<string>;
  forceExpand: boolean;
  onToggleDir: (path: string) => void;
  onSetSelected: (indices: number[], selected: boolean) => void;
}

function ReviewNodeRow(props: ReviewNodeRowProps) {
  if (props.node.type === 'file') {
    return <ReviewFileRow node={props.node} depth={props.depth} onSetSelected={props.onSetSelected} />;
  }
  return <ReviewDirRow {...props} node={props.node} />;
}

function ReviewDirRow({
  node,
  depth,
  expandedDirs,
  forceExpand,
  onToggleDir,
  onSetSelected,
}: ReviewNodeRowProps & { node: DirNode }) {
  const expanded = forceExpand || expandedDirs.has(node.path);
  const checkState = getCheckState(node);
  const indent = Math.min(depth, 4) * 16;

  return (
    <>
      <div className="border-b border-border/50">
        <div
          className="flex items-center gap-2 px-3 py-2.5"
          style={{ paddingLeft: `${12 + indent}px` }}
        >
          <input
            type="checkbox"
            checked={checkState === 'all'}
            aria-label={`Select ${node.name}`}
            ref={(el) => {
              if (el) el.indeterminate = checkState === 'indeterminate';
            }}
            onChange={() => onSetSelected(getAllFileIndices(node), checkState !== 'all')}
            className="rounded border-border h-4 w-4 shrink-0"
          />

          <button
            className="flex items-center gap-1.5 min-w-0 flex-1"
            onClick={() => onToggleDir(node.path)}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium truncate">{node.name}</span>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {node.selectedCount}/{node.fileCount}
            </span>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {formatBytes(node.totalSize)}
            </span>
          </div>
        </div>
      </div>

      {expanded &&
        node.children.map((child) => (
          <ReviewNodeRow
            key={child.type === 'file' ? `f-${child.file.index}` : `d-${child.path}`}
            node={child}
            depth={depth + 1}
            expandedDirs={expandedDirs}
            forceExpand={forceExpand}
            onToggleDir={onToggleDir}
            onSetSelected={onSetSelected}
          />
        ))}
    </>
  );
}

function ReviewFileRow({
  node,
  depth,
  onSetSelected,
}: {
  node: FileNode;
  depth: number;
  onSetSelected: (indices: number[], selected: boolean) => void;
}) {
  const { file } = node;
  const isSelected = file.priority > 0;
  const indent = Math.min(depth, 4) * 16;

  return (
    <div className="border-b border-border/50">
      <label
        className="flex items-start gap-2 px-3 py-2.5 cursor-pointer"
        style={{ paddingLeft: `${12 + indent}px` }}
      >
        <input
          type="checkbox"
          checked={isSelected}
          aria-label={`Select ${node.name}`}
          onChange={() => onSetSelected([file.index], !isSelected)}
          className="rounded border-border h-4 w-4 mt-0.5 shrink-0"
        />
        <File className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
        <span className="text-xs break-all line-clamp-2 leading-snug flex-1">{node.name}</span>
        <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
          {formatBytes(file.size)}
        </span>
      </label>
    </div>
  );
}
