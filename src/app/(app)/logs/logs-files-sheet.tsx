'use client';

import { useEffect, useState } from 'react';
import { Download, Loader2, Trash2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { cn } from '@/lib/utils';

export interface LogFile {
  name: string;
  size: number;
  modifiedAt: string;
}

interface LogsFilesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: LogFile[];
  selectedFile: string;
  onSelectFile: (file: string) => void;
  onDownloadFile: (file: string) => void;
  onDeleteFile: (file: string) => void;
  deletingFile: string | null;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatRelative(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

interface FileListProps extends Omit<LogsFilesSheetProps, 'open' | 'onOpenChange'> {
  onClose: () => void;
}

function FileList({
  files,
  selectedFile,
  onSelectFile,
  onDownloadFile,
  onDeleteFile,
  deletingFile,
  onClose,
}: FileListProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <button
        type="button"
        onClick={() => {
          onSelectFile('all');
          onClose();
        }}
        className={cn(
          'flex w-full items-center justify-between gap-3 border-b border-[oklch(1_0_0/6%)] px-4 py-3 text-left hover:bg-accent/40 transition-colors',
          selectedFile === 'all' && 'bg-accent/30'
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          {selectedFile === 'all' ? (
            <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-transparent shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium">All files</div>
            <div className="text-xs text-muted-foreground">Search across every log file</div>
          </div>
        </div>
      </button>
      {files.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          No log files yet
        </div>
      ) : (
        files.map((file) => {
          const isSelected = selectedFile === file.name;
          const isDeleting = deletingFile === file.name;
          return (
            <div
              key={file.name}
              className={cn(
                'flex items-center gap-2 border-b border-[oklch(1_0_0/6%)] px-4 py-3 last:border-b-0',
                isSelected && 'bg-accent/30'
              )}
            >
              <button
                type="button"
                onClick={() => {
                  onSelectFile(file.name);
                  onClose();
                }}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                {isSelected ? (
                  <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-transparent shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium font-mono">{file.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatBytes(file.size)} · {formatRelative(file.modifiedAt)}
                  </div>
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => onDownloadFile(file.name)}
                  aria-label={`Download ${file.name}`}
                  className="h-9 w-9 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteFile(file.name)}
                  disabled={isDeleting}
                  aria-label={`Delete ${file.name}`}
                  className="h-9 w-9 flex items-center justify-center rounded-md text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export function LogsFilesSheet({
  open,
  onOpenChange,
  files,
  selectedFile,
  onSelectFile,
  onDownloadFile,
  onDeleteFile,
  deletingFile,
}: LogsFilesSheetProps) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const list = (
    <FileList
      files={files}
      selectedFile={selectedFile}
      onSelectFile={onSelectFile}
      onDownloadFile={onDownloadFile}
      onDeleteFile={onDeleteFile}
      deletingFile={deletingFile}
      onClose={() => onOpenChange(false)}
    />
  );

  const titleNode = (
    <span className="tracked-caps text-xs text-muted-foreground">
      Log files <span className="text-foreground/80 ml-1">({files.length})</span>
    </span>
  );

  if (isDesktop) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-3/4 sm:max-w-md p-0 gap-0">
          <SheetHeader className="border-b border-border">
            <SheetTitle asChild>{titleNode}</SheetTitle>
            <SheetDescription className="sr-only">
              List of log files available for download.
            </SheetDescription>
          </SheetHeader>
          {list}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="border-b border-border">
          <DrawerTitle asChild>{titleNode}</DrawerTitle>
          <DrawerDescription className="sr-only">
            List of log files available for download.
          </DrawerDescription>
        </DrawerHeader>
        {list}
      </DrawerContent>
    </Drawer>
  );
}
