'use client';

import { Button } from '@/components/ui/button';
import { AlertTriangle, Upload, RefreshCw } from 'lucide-react';
import type { QueueItem } from '@/types';

// --- Status helpers ---

// Shared error empty-state for the tabs: a dead arr instance must not
// masquerade as an empty list.
export function TabErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="text-center py-16 text-muted-foreground">
      <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-40 text-red-500" />
      <p className="text-sm">{message}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
      </Button>
    </div>
  );
}

export function ManualImportStrip({ item, onImport }: { item: QueueItem; onImport: () => void }) {
  const reason = item.statusMessages?.flatMap((message) => message.messages ?? [])[0]
    ?? item.statusMessages?.[0]?.title;
  return (
    <div className="flex items-center gap-2 border-t border-border/40 px-3 py-2">
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {reason ?? 'Needs a manual import'}
      </p>
      <Button size="sm" className="h-8 shrink-0 text-xs" onClick={onImport}>
        <Upload className="mr-1.5 h-3.5 w-3.5" /> Import
      </Button>
    </div>
  );
}
