'use client';

import { useRouteViewState } from '@/lib/hooks/use-route-view-state';

import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { useParams, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronRight, ChevronDown, Download, Folder, File, Gauge, Loader2, MoreVertical, Pencil, X } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { PageHeader } from '@/components/layout/page-header';
import { QuickContextMenu, type ContextActionGroup } from '@/components/ui/quick-context-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatBytes } from '@/lib/format';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
import { useCan } from '@/components/permission-provider';
import type { TorrentFile } from '@/lib/qbittorrent-client';
import type { RenameArrUse } from '@/app/api/qbittorrent/[hash]/files/rename/route';
import {
  buildFileTree,
  getAllFileIndices,
  getCheckState,
  type TreeNode,
  type DirNode,
  type FileNode,
} from '@/lib/torrent-file-tree';

/** A file or folder being renamed: its path in the torrent and its name now. */
interface RenameTarget {
  kind: 'file' | 'folder';
  path: string;
  name: string;
}

/** Why the server wants a rename confirmed: an arr downloads into the torrent's category. */
interface RenameWarning {
  category: string;
  uses: RenameArrUse[];
  /** Instances that did not answer, by name for an admin. */
  unchecked: string[];
  someUnchecked: boolean;
}

type RenameResult = { ok: true; path: string } | ({ ok: false } & RenameWarning);

const renameKey = (target: Pick<RenameTarget, 'kind' | 'path'>) => `${target.kind}:${target.path}`;

const PRIORITY_OPTIONS = [
  { value: '0', label: 'Skip' },
  { value: '1', label: 'Normal' },
  { value: '6', label: 'High' },
  { value: '7', label: 'Max' },
];

export default function TorrentFilesPage() {
  const params = useParams<{ hash: string }>();
  const searchParams = useSearchParams();
  const hash = params.hash;
  const torrentName = searchParams.get('name') || undefined;
  const canManage = useCan('torrents.manage');

  const [expandedDirs, setExpandedDirs] = useRouteViewState<Set<string>>('TorrentFilesPage:expandedDirs', new Set());
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);
  const queryClient = useQueryClient();
  const filesKey = ['qbittorrent', hash, 'files'] as const;

  // Optimistic priority change. A 401 carries its status to the global
  // MutationCache handler (redirect to /login).
  const setPriorityMutation = useMutation({
    mutationFn: async ({ fileIds, priority }: { fileIds: number[]; priority: number }) => {
      const res = await fetch(`/api/qbittorrent/${hash}/files/priority`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: fileIds, priority }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new ApiError(res.status, data?.error || 'Failed to set priority');
      }
    },
    onMutate: async ({ fileIds, priority }) => {
      // Cancel any in-flight poll so it can't clobber the optimistic value.
      await queryClient.cancelQueries({ queryKey: filesKey });
      const previous = queryClient.getQueryData<{ files: TorrentFile[] }>(filesKey);
      queryClient.setQueryData<{ files: TorrentFile[] }>(filesKey, (old) =>
        old
          ? { ...old, files: old.files.map((f) => (fileIds.includes(f.index) ? { ...f, priority } : f)) }
          : old,
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(filesKey, context.previous);
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Failed to set priority');
    },
  });
  const { mutate: mutatePriority, isPending: priorityPending } = setPriorityMutation;

  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [renameWarning, setRenameWarning] = useState<RenameWarning | null>(null);
  const { mutateAsync: mutateRename, isPending: renamePending } = useMutation({
    mutationFn: async ({ target, name, confirm }: { target: RenameTarget; name: string; confirm: boolean }): Promise<RenameResult> => {
      const res = await fetch(`/api/qbittorrent/${hash}/files/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: target.kind, path: target.path, name, confirm }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 409 && data?.needsConfirm === true) {
        return {
          ok: false,
          category: typeof data.category === 'string' ? data.category : '',
          uses: Array.isArray(data.uses) ? data.uses : [],
          unchecked: Array.isArray(data.unchecked) ? data.unchecked : [],
          someUnchecked: data.someUnchecked === true,
        };
      }
      // ApiError so a 401 reaches the global MutationCache handler (redirect).
      if (!res.ok) throw new ApiError(res.status, data?.error || 'Failed to rename');
      return { ok: true, path: typeof data?.path === 'string' ? data.path : target.path };
    },
  });

  const startRename = useCallback((target: RenameTarget) => {
    setRenameWarning(null);
    setRenaming(target);
  }, []);
  const cancelRename = useCallback(() => {
    setRenameWarning(null);
    setRenaming(null);
  }, []);

  const submitRename = async (target: RenameTarget, name: string) => {
    try {
      const result = await mutateRename({ target, name, confirm: renameWarning !== null });
      if (!result.ok) {
        // The editor stays open with the warning; its button then confirms.
        setRenameWarning(result);
        return;
      }
      if (target.kind === 'folder') {
        // An open folder (and the ones open inside it) stays open under its new name.
        setExpandedDirs((prev) => new Set([...prev].map((dir) => (
          dir === target.path || dir.startsWith(`${target.path}/`) ? `${result.path}${dir.slice(target.path.length)}` : dir
        ))));
      }
      // The new names at once: a poll that still has the old ones can't show them meanwhile.
      await queryClient.cancelQueries({ queryKey: filesKey });
      queryClient.setQueryData<{ files: TorrentFile[] }>(filesKey, (old) => old && {
        ...old,
        files: old.files.map((file) => {
          if (target.kind === 'file') return file.name === target.path ? { ...file, name: result.path } : file;
          return file.name.startsWith(`${target.path}/`) ? { ...file, name: `${result.path}${file.name.slice(target.path.length)}` } : file;
        }),
      });
      cancelRename();
      toast.success(`Renamed to ${name}`);
      void queryClient.invalidateQueries({ queryKey: filesKey });
    } catch (err) {
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (!(err instanceof ApiError && err.status === 401)) {
        toast.error(err instanceof Error ? err.message : 'Failed to rename');
      }
      // Gone from the torrent meanwhile: show the list as it is now.
      if (err instanceof ApiError && err.status === 404) {
        cancelRename();
        void queryClient.invalidateQueries({ queryKey: filesKey });
      }
    }
  };

  const renameForm = renaming && (
    <RenameForm
      key={renameKey(renaming)}
      target={renaming}
      pending={renamePending}
      warning={renameWarning}
      onSubmit={(name) => void submitRename(renaming, name)}
      onCancel={cancelRename}
    />
  );
  const rename = { activeKey: renaming ? renameKey(renaming) : null, form: renameForm, onStart: startRename };

  const filesQuery = useQuery({
    queryKey: filesKey,
    // The files route, not /details: that one also asks qBittorrent for the
    // properties, trackers and magnet, which this page doesn't show.
    queryFn: jsonFetcher<{ files: TorrentFile[] }>(`/api/qbittorrent/${hash}/files`),
    select: (d) => d.files ?? [],
    // Pause polling while a priority change is in flight so the next poll can't
    // overwrite the optimistic update before the server commits (matches the old
    // pendingMutationRef guard).
    refetchInterval: () => (priorityPending || renamePending ? false : refreshIntervalMs),
    refetchIntervalInBackground: false,
  });
  const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);
  const loading = filesQuery.isLoading;
  const error = filesQuery.error;

  useEffect(() => {
    async function loadRefreshInterval() {
      const ms = await getRefreshIntervalMs('torrentsRefreshIntervalSecs', 5);
      setRefreshIntervalMs(ms);
    }
    loadRefreshInterval();
  }, []);

  const tree = useMemo(() => buildFileTree(files), [files]);

  const totalSize = useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files]);
  const weightedProgress = useMemo(() => {
    if (totalSize === 0) return 0;
    const wp = files.reduce((sum, f) => sum + f.progress * f.size, 0);
    return wp / totalSize;
  }, [files, totalSize]);

  const setPriority = useCallback((fileIds: number[], priority: number) => {
    mutatePriority({ fileIds, priority });
  }, [mutatePriority]);

  // Toggle file download (priority 0 <-> 1)
  const toggleFileDownload = useCallback((fileIds: number[], currentlySelected: boolean) => {
    const newPriority = currentlySelected ? 0 : 1;
    setPriority(fileIds, newPriority);
  }, [setPriority]);

  // Toggle directory expand/collapse
  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, [setExpandedDirs]);

  if (loading && files.length === 0) {
    return (
      <div className="space-y-3">
        <PageHeader title={canManage ? 'Manage Files' : 'Files'} subtitle={torrentName} backHref="/torrents" />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error && files.length === 0) {
    return (
      <div className="space-y-3">
        <PageHeader title={canManage ? 'Manage Files' : 'Files'} subtitle={torrentName} backHref="/torrents" />
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
          <p>{error?.message ?? 'Failed to fetch files'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-content-in">
      <PageHeader title={canManage ? 'Manage Files' : 'Files'} subtitle={torrentName} backHref="/torrents" />

      {files.length === 0 ? (
        // Metadata not fetched yet (magnet still resolving) or a file-less
        // torrent — say so instead of a "0 files" summary over an empty card.
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
          <File className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>No files in this torrent yet.</p>
          <p className="text-sm mt-1">Metadata may still be downloading.</p>
        </div>
      ) : (
        <>
          {/* Summary bar */}
          <div className="rounded-xl bg-card p-3 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{files.length} file{files.length !== 1 ? 's' : ''}</span>
              <span>{formatBytes(totalSize)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Progress value={weightedProgress * 100} className="h-1.5 flex-1" />
              <span className="text-xs text-muted-foreground shrink-0">
                {(weightedProgress * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          {/* File tree */}
          <div className="rounded-xl bg-card overflow-hidden">
            {tree.map((node) => (
              <TreeNodeRow
                key={node.type === 'file' ? `f-${node.file.index}` : `d-${node.path}`}
                node={node}
                depth={0}
                expandedDirs={expandedDirs}
                canManage={canManage}
                rename={rename}
                onToggleDir={toggleDir}
                onToggleDownload={toggleFileDownload}
                onSetPriority={setPriority}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}


/** The row being renamed (`activeKey`, see renameKey) shows `form` in its place. */
interface RowRename {
  activeKey: string | null;
  form: ReactNode;
  onStart: (target: RenameTarget) => void;
}

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  expandedDirs: Set<string>;
  canManage: boolean;
  rename: RowRename;
  onToggleDir: (path: string) => void;
  onToggleDownload: (fileIds: number[], currentlySelected: boolean) => void;
  onSetPriority: (fileIds: number[], priority: number) => void;
}

function TreeNodeRow({
  node,
  depth,
  expandedDirs,
  canManage,
  rename,
  onToggleDir,
  onToggleDownload,
  onSetPriority,
}: TreeNodeRowProps) {
  if (node.type === 'file') {
    return (
      <FileRow
        node={node}
        depth={depth}
        canManage={canManage}
        rename={rename}
        onToggleDownload={onToggleDownload}
        onSetPriority={onSetPriority}
      />
    );
  }

  return (
    <DirRow
      node={node}
      depth={depth}
      expandedDirs={expandedDirs}
      canManage={canManage}
      rename={rename}
      onToggleDir={onToggleDir}
      onToggleDownload={onToggleDownload}
      onSetPriority={onSetPriority}
    />
  );
}

function DirRow({
  node,
  depth,
  expandedDirs,
  canManage,
  rename,
  onToggleDir,
  onToggleDownload,
  onSetPriority,
}: TreeNodeRowProps & { node: DirNode }) {
  const expanded = expandedDirs.has(node.path);
  const checkState = getCheckState(node);
  const progress = node.totalSize > 0 ? node.weightedProgress / node.totalSize : 0;
  const indent = Math.min(depth, 4) * 16;
  const allIndices = getAllFileIndices(node);

  const handleCheckboxChange = () => {
    onToggleDownload(allIndices, checkState === 'all');
  };

  const groups: ContextActionGroup[] = [
    {
      id: 'folder',
      actions: [
        {
          id: 'toggle-folder',
          label: expanded ? 'Collapse folder' : 'Expand folder',
          icon: expanded
            ? <ChevronDown className="h-4 w-4" />
            : <ChevronRight className="h-4 w-4" />,
          onSelect: () => onToggleDir(node.path),
        },
        ...(canManage
          ? [{
              id: 'toggle-download',
              label: checkState === 'all' ? 'Skip all files' : 'Download all files',
              icon: checkState === 'all'
                ? <X className="h-4 w-4" />
                : <Download className="h-4 w-4" />,
              onSelect: () => onToggleDownload(allIndices, checkState === 'all'),
            }]
          : []),
      ],
    },
    {
      id: 'priority',
      actions: canManage
        ? PRIORITY_OPTIONS.filter((option) => option.value !== '0').map((option) => ({
            id: `priority-${option.value}`,
            label: `${option.label} priority`,
            icon: <Gauge className="h-4 w-4" />,
            onSelect: () => onSetPriority(allIndices, Number(option.value)),
          }))
        : [],
    },
    {
      id: 'rename',
      actions: canManage
        ? [{
            id: 'rename',
            label: 'Rename folder',
            icon: <Pencil className="h-4 w-4" />,
            onSelect: () => rename.onStart({ kind: 'folder', path: node.path, name: node.name }),
          }]
        : [],
    },
  ];

  return (
    <>
      <div className="border-b border-border/50">
        {rename.activeKey === renameKey({ kind: 'folder', path: node.path }) ? (
          <div style={{ paddingLeft: `${indent}px` }}>{rename.form}</div>
        ) : (
          <div
            className="flex items-center gap-2 px-3 py-2.5"
            style={{ paddingLeft: `${12 + indent}px` }}
          >
            {/* Checkbox */}
            {canManage && (
              <span className="relative flex items-center justify-center shrink-0">
                <input
                  type="checkbox"
                  checked={checkState === 'all'}
                  aria-label={`Select ${node.name}`}
                  ref={(el) => {
                    if (el) el.indeterminate = checkState === 'indeterminate';
                  }}
                  onChange={handleCheckboxChange}
                  className="rounded border-border h-4 w-4"
                />
              </span>
            )}

            {/* Expand toggle + folder icon + name */}
            <QuickContextMenu label={`Actions for ${node.name}`} groups={groups}>
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
            </QuickContextMenu>

            {/* Stats */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {node.selectedCount}/{node.fileCount}
              </span>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {formatBytes(node.totalSize)}
              </span>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {(progress * 100).toFixed(0)}%
              </span>
            </div>
            {canManage && <RowMenu label={`More actions for ${node.name}`} groups={groups} />}
          </div>
        )}
      </div>

      {expanded &&
        node.children.map((child) => (
          <TreeNodeRow
            key={child.type === 'file' ? `f-${child.file.index}` : `d-${child.path}`}
            node={child}
            depth={depth + 1}
            expandedDirs={expandedDirs}
            canManage={canManage}
            rename={rename}
            onToggleDir={onToggleDir}
            onToggleDownload={onToggleDownload}
            onSetPriority={onSetPriority}
          />
        ))}
    </>
  );
}

function FileRow({
  node,
  depth,
  canManage,
  rename,
  onToggleDownload,
  onSetPriority,
}: {
  node: FileNode;
  depth: number;
  canManage: boolean;
  rename: RowRename;
  onToggleDownload: (fileIds: number[], currentlySelected: boolean) => void;
  onSetPriority: (fileIds: number[], priority: number) => void;
}) {
  const { file } = node;
  const isSelected = file.priority > 0;
  const indent = Math.min(depth, 4) * 16;
  const remaining = file.size * (1 - file.progress);

  if (rename.activeKey === renameKey({ kind: 'file', path: file.name })) {
    return (
      <div className="border-b border-border/50" style={{ paddingLeft: `${indent}px` }}>
        {rename.form}
      </div>
    );
  }

  const groups: ContextActionGroup[] = [
    {
      id: 'download',
      actions: canManage
        ? [{
            id: 'toggle-download',
            label: isSelected ? 'Skip file' : 'Download file',
            icon: isSelected
              ? <X className="h-4 w-4" />
              : <Download className="h-4 w-4" />,
            onSelect: () => onToggleDownload([file.index], isSelected),
          }]
        : [],
    },
    {
      id: 'priority',
      actions: canManage
        ? PRIORITY_OPTIONS.filter((option) => option.value !== '0').map((option) => ({
            id: `priority-${option.value}`,
            label: `${option.label} priority`,
            icon: <Gauge className="h-4 w-4" />,
            disabled: Number(option.value) === file.priority,
            onSelect: () => onSetPriority([file.index], Number(option.value)),
          }))
        : [],
    },
    {
      id: 'rename',
      actions: canManage
        ? [{
            id: 'rename',
            label: 'Rename file',
            icon: <Pencil className="h-4 w-4" />,
            onSelect: () => rename.onStart({ kind: 'file', path: file.name, name: node.name }),
          }]
        : [],
    },
  ];

  return (
    <div className="border-b border-border/50">
      <div
        className="px-3 py-2.5 space-y-1.5"
        style={{ paddingLeft: `${12 + indent}px` }}
      >
        {/* Row 1: checkbox + icon + name */}
        <QuickContextMenu label={`Actions for ${node.name}`} groups={groups}>
          <div className="flex items-start gap-2">
            {canManage && (
              <input
                type="checkbox"
                checked={isSelected}
                aria-label={`Select ${node.name}`}
                onChange={() => onToggleDownload([file.index], isSelected)}
                className="rounded border-border h-4 w-4 mt-0.5 shrink-0"
              />
            )}
            <File className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
            <span className="text-xs break-all line-clamp-2 leading-snug flex-1">{node.name}</span>
            <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
              {formatBytes(file.size)}
            </span>
            {canManage && <RowMenu label={`More actions for ${node.name}`} groups={groups} />}
          </div>
        </QuickContextMenu>

        {/* Row 2: progress bar */}
        <div className="flex items-center gap-2 ml-[calc(16px+8px)]">
          <Progress value={file.progress * 100} className="h-1 flex-1" />
          <span className="text-[10px] text-muted-foreground shrink-0">
            {(file.progress * 100).toFixed(0)}%
          </span>
        </div>

        {/* Row 3: remaining, availability, priority */}
        <div className="flex items-center gap-3 ml-[calc(16px+8px)] flex-wrap">
          {file.priority === 0 ? (
            <span className="text-[10px] text-muted-foreground">Skipped</span>
          ) : file.progress < 1 && remaining > 0 ? (
            <span className="text-[10px] text-muted-foreground">
              Remaining: {formatBytes(remaining)}
            </span>
          ) : file.progress >= 1 ? (
            <span className="text-[10px] text-green-500">Complete</span>
          ) : null}

          {file.availability >= 0 && (
            <span className="text-[10px] text-muted-foreground">
              Avail: {(file.availability * 100).toFixed(0)}%
            </span>
          )}

          <div className="ml-auto">
            {canManage ? (
            <Select
              value={String(file.priority)}
              onValueChange={(val) => {
                const p = Number(val);
                if (p !== file.priority) {
                  onSetPriority([file.index], p);
                }
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label={`Priority for ${node.name}`}
                className="h-6 text-[10px] px-2 min-w-[70px] border-border/50"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                {PRIORITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                {PRIORITY_OPTIONS.find((option) => Number(option.value) === file.priority)?.label ?? `Priority ${file.priority}`}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The row's ⋮ menu: the same actions as its long-press menu, for a tap or a mouse. */
function RowMenu({ label, groups }: { label: string; groups: ContextActionGroup[] }) {
  const shown = groups.filter((group) => group.actions.length > 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* 24px drawn, 44px to tap (touch-target): the row keeps its height. */}
        <Button variant="ghost" size="icon-xs" className="relative touch-target -my-0.5 shrink-0" aria-label={label}>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {shown.map((group, index) => (
          <Fragment key={group.id ?? index}>
            {index > 0 && <DropdownMenuSeparator />}
            {group.actions.map((action) => (
              <DropdownMenuItem key={action.id} disabled={action.disabled} onClick={action.onSelect}>
                {action.icon} {action.label}
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The inline editor for a new name, in the row's place, as Manage Trackers edits a tracker. */
function RenameForm({
  target,
  pending,
  warning,
  onSubmit,
  onCancel,
}: {
  target: RenameTarget;
  pending: boolean;
  warning: RenameWarning | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(target.name);
  const name = value.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name || name === target.name || pending) return;
    onSubmit(name);
  };

  return (
    <form
      className="space-y-2 px-3 py-2.5"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !pending) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <p className="text-xs text-muted-foreground">{target.kind === 'file' ? 'Rename file' : 'Rename folder'}</p>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        // A file's name up to its extension, ready to type over.
        onFocus={(e) => {
          const dot = target.kind === 'file' ? e.target.value.lastIndexOf('.') : -1;
          e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
        }}
        aria-label={target.kind === 'file' ? 'New file name' : 'New folder name'}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={255}
        disabled={pending}
        autoFocus
      />
      {warning && (
        <div role="alert" className="space-y-1 text-xs text-destructive">
          {warning.uses.map((use) => (
            <p key={`${use.app}|${use.instance}`}>
              {use.instance === use.app ? use.app : `${use.app} (${use.instance})`} downloads into {warning.category}.
            </p>
          ))}
          {warning.unchecked.length > 0 ? (
            <p>Did not answer, so not checked: {warning.unchecked.join(', ')}.</p>
          ) : warning.someUnchecked && (
            <p>Some of Sonarr, Radarr and Lidarr did not answer, so they were not checked.</p>
          )}
          <p>Renaming inside this torrent can stop its import: the app looks for the files by the names it grabbed.</p>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={pending || !name || name === target.name}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {warning ? 'Rename Anyway' : 'Rename'}
        </Button>
        <Button type="button" variant="outline" className="flex-1" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
