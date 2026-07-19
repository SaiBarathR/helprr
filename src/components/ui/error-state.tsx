'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Shared fetch-failure state with an optional Retry action. A dead upstream
 * must not masquerade as an empty list or a missing resource, so pages render
 * this when a query errors instead of their empty/not-found copy.
 */
export function ErrorState({
  message,
  onRetry,
  retrying = false,
  compact = false,
  className,
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  /** Tighter spacing for section-level (non-page) placements. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn('text-center text-muted-foreground', compact ? 'py-8' : 'py-16', className)}
    >
      <AlertTriangle
        className={cn('mx-auto mb-2 opacity-40 text-red-500', compact ? 'h-6 w-6' : 'h-8 w-8')}
      />
      <p className="text-sm">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', retrying && 'animate-spin')} /> Retry
        </Button>
      )}
    </div>
  );
}
