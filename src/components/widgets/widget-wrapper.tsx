'use client';

import { Component, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import type { WidgetSize } from '@/lib/widgets/types';

interface WidgetWrapperProps {
  size: WidgetSize;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class WidgetErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl bg-card p-4 flex items-center justify-center text-xs text-muted-foreground">
          Widget failed to load
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

export function WidgetWrapper({ size, children }: WidgetWrapperProps) {
  return (
    <WidgetErrorBoundary>
      {children}
    </WidgetErrorBoundary>
  );
}
