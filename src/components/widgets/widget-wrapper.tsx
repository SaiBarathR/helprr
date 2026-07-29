'use client';

import { Component, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

interface WidgetWrapperProps {
  widgetId: string;
  children: () => ReactNode;
  onRetry: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class WidgetErrorBoundary extends Component<WidgetWrapperProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(prevProps: Readonly<WidgetWrapperProps>) {
    if (this.state.error && prevProps.widgetId !== this.props.widgetId) {
      this.setState({ error: null });
    }
  }

  private resetError = () => {
    if (isChunkLoadError(this.state.error) && globalThis.navigator.onLine) {
      reloadAfterClearingPageCache();
      return;
    }
    this.props.onRetry();
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl bg-card p-4 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
          <span>Widget {this.props.widgetId} failed to load</span>
          <button
            type="button"
            onClick={this.resetError}
            className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children();
  }
}

export function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  return (
    error.name === 'ChunkLoadError' ||
    /Loading chunk \d+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i
      .test(error.message)
  );
}

function reloadAfterClearingPageCache(): void {
  const reload = () => globalThis.location.reload();
  if (!('caches' in globalThis)) {
    reload();
    return;
  }
  void globalThis.caches.delete('pages').finally(reload);
}

export function WidgetSkeleton({ rowSpan = 1 }: { rowSpan?: number }) {
  const h = rowSpan >= 2 ? 'h-[280px]' : 'h-[120px]';
  return <Skeleton className={`${h} w-full rounded-[10px]`} />;
}

export function WidgetWrapper({ widgetId, children, onRetry }: WidgetWrapperProps) {
  return (
    <WidgetErrorBoundary widgetId={widgetId} onRetry={onRetry}>
      {children}
    </WidgetErrorBoundary>
  );
}
