'use client';

import { Component, Fragment, type ReactNode } from 'react';
import { CircleAlert, WifiOff } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { isChunkLoadError, reloadForChunkLoadError, reloadWhenServerAnswers } from '@/lib/chunk-load-recovery';
import type { WidgetUnavailable } from '@/lib/widgets/widget-unavailable-context';
import { FONT_BODY, HPR } from './bento-primitives';

interface WidgetWrapperProps {
  widgetId: string;
  /** The widget's title, shown when it can't load. */
  name: string;
  children: () => ReactNode;
  onRetry: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Why a widget has nothing to show: its name, and that the device is offline,
 * Helprr can't be reached, or its data couldn't load. EmptyState's look, sized for a one-cell phone
 * widget too (about 44×60 inside the card at 320): the name takes up to two
 * lines there, and globals.css drops the icon and "right now." where they
 * don't fit. Fills the nearest positioned parent.
 */
export function WidgetCover({ name, reason, children }: { name: string; reason: WidgetUnavailable; children?: ReactNode }) {
  const Icon = reason === 'error' ? CircleAlert : WifiOff;
  return (
    <div role="status" className="widget-cover" style={{ position: 'absolute', inset: 0, container: 'widget-cover / size' }}>
      <div
        className="widget-cover-body"
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          // Anything that still doesn't fit is cut at the bottom, never the name at the top.
          justifyContent: 'safe center',
          overflow: 'hidden',
          color: HPR.fgSubtle,
          fontSize: 11,
          // Four 11px lines (name + three of message) fit a 60px one-cell cover.
          lineHeight: 1.25,
          fontFamily: FONT_BODY,
          textAlign: 'center',
        }}
      >
        <Icon size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
        {/* Whole words, each its own span, so where the name may take two
            lines (globals.css) a word too long for the line ends in "…"
            instead of being cut at the edge: a one-cell cover read "Service Hea…". */}
        <span className="widget-cover-name" style={{ flexShrink: 0, color: HPR.fgMute, fontWeight: 600, maxWidth: '100%' }}>
          {name.split(' ').map((word, i) => (
            <Fragment key={i}>{i > 0 && ' '}<span>{word}</span></Fragment>
          ))}
        </span>
        {reason === 'offline'
          ? <span>You&apos;re offline</span>
          : reason === 'unreachable'
            ? <span>Can’t reach Helprr<span className="widget-cover-tail"> right now.</span></span>
            : <span>Couldn’t load<span className="widget-cover-tail"> its data.</span></span>}
        {children}
      </div>
    </div>
  );
}

export const retryButtonClass = 'rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground';

class WidgetErrorBoundary extends Component<WidgetWrapperProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidMount() {
    window.addEventListener('online', this.retryWhenOnline);
    window.addEventListener('offline', this.showOffline);
  }

  componentWillUnmount() {
    window.removeEventListener('online', this.retryWhenOnline);
    window.removeEventListener('offline', this.showOffline);
  }

  componentDidCatch(error: Error) {
    // A chunk gone after a deploy: reload once the server answers, as the page
    // boundaries do. Guarded, so it can't loop; offline it does nothing.
    reloadForChunkLoadError(error);
  }

  componentDidUpdate(prevProps: Readonly<WidgetWrapperProps>) {
    if (this.state.error && prevProps.widgetId !== this.props.widgetId) {
      this.setState({ error: null });
    }
  }

  // A widget whose code couldn't load offline tries again by itself when the
  // network comes back, as the widgets' own data does.
  private retryWhenOnline = () => {
    if (!isChunkLoadError(this.state.error)) return;
    this.props.onRetry();
    this.setState({ error: null });
  };

  // The cover says offline or can't-reach from navigator.onLine; keep it current.
  private showOffline = () => {
    if (isChunkLoadError(this.state.error)) this.forceUpdate();
  };

  private resetError = () => {
    // A deploy may have removed the chunk: that reloads once the server answers
    // (never when it can't be reached, which would drop the saved pages). Try
    // the widget again either way.
    void reloadWhenServerAnswers(this.state.error);
    this.props.onRetry();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error && isChunkLoadError(error)) {
      // Its code didn't load, which is what being offline looks like for a
      // widget that hadn't been shown yet: say so as the offline cover does.
      return (
        <div style={{ position: 'relative', height: '100%', minHeight: 0 }}>
          <WidgetCover name={this.props.name} reason={globalThis.navigator.onLine ? 'unreachable' : 'offline'}>
            <button type="button" onClick={this.resetError} className={`mt-1.5 shrink-0 ${retryButtonClass}`}>
              Retry
            </button>
          </WidgetCover>
        </div>
      );
    }
    if (error) {
      return (
        <div className="rounded-xl bg-card p-4 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
          <span>{this.props.name} failed to load</span>
          <button type="button" onClick={this.resetError} className={retryButtonClass}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children();
  }
}

export function WidgetSkeleton({ rowSpan = 1 }: { rowSpan?: number }) {
  const h = rowSpan >= 2 ? 'h-[280px]' : 'h-[120px]';
  return <Skeleton className={`${h} w-full rounded-[10px]`} />;
}

export function WidgetWrapper({ widgetId, name, children, onRetry }: WidgetWrapperProps) {
  return (
    <WidgetErrorBoundary widgetId={widgetId} name={name} onRetry={onRetry}>
      {children}
    </WidgetErrorBoundary>
  );
}
