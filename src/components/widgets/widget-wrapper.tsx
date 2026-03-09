'use client';

import { Component, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import type { WidgetSize } from '@/lib/widgets/types';

interface WidgetWrapperProps {
  widgetId: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class WidgetErrorBoundary extends Component<{ children: ReactNode; widgetId: string }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: Readonly<{ children: ReactNode; widgetId: string }>) {
    if (this.state.hasError && prevProps.widgetId !== this.props.widgetId) {
      this.setState({ hasError: false });
    }
  }

  private resetError = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl bg-card p-4 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
          <span>Widget failed to load</span>
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
    return this.props.children;
  }
}

export function WidgetSkeleton({ size }: { size: WidgetSize }) {
  const h = size === 'large' ? 'h-[280px]' : size === 'medium' ? 'h-[160px]' : 'h-[120px]';
  return <Skeleton className={`${h} w-full rounded-xl`} />;
}

export function WidgetWrapper({ widgetId, children }: WidgetWrapperProps) {
  return (
    <WidgetErrorBoundary widgetId={widgetId}>
      {children}
    </WidgetErrorBoundary>
  );
}
