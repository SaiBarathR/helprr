'use client';

import { createElement, Suspense, type ReactNode } from 'react';
import { WifiOff } from 'lucide-react';
import { useNearViewport } from '@/lib/hooks/use-near-viewport';
import { getWidgetDefinition } from '@/lib/widgets/registry';
import {
  describeRequiredWidgetServices,
  hasRequiredWidgetServices,
  widgetServiceSetupPath,
} from '@/lib/widgets/availability';
import Link from '@/components/ui/app-link';
import { useCan } from '@/components/permission-provider';
import { useConfiguredWidgetServices } from '@/lib/widgets/widget-availability-context';
import { WidgetVisibilityProvider } from '@/lib/widgets/widget-visibility-context';
import { useWidgetUnavailableReports, WidgetUnavailableProvider } from '@/lib/widgets/widget-unavailable-context';
import { getWidgetComponent, resetWidgetComponent } from './widget-loaders';
import { WidgetWrapper, WidgetSkeleton } from './widget-wrapper';
import { useUIStore } from '@/lib/store';
import type { WidgetInstance, WidgetLayoutVariant, WidgetProps } from '@/lib/widgets/types';
import { FONT_BODY, HPR } from './bento-primitives';

interface WidgetRendererProps {
  instance: WidgetInstance;
  editMode?: boolean;
  narrow?: boolean;
  colSpan?: number;
  rowSpan?: number;
  layoutVariant?: WidgetLayoutVariant;
  mobileGrid?: boolean;
}

export function WidgetRenderer({
  instance,
  editMode = false,
  narrow,
  colSpan,
  rowSpan,
  layoutVariant,
  mobileGrid,
}: WidgetRendererProps) {
  const discoverLayout = useUIStore((s) => s.discoverLayout);
  const definition = getWidgetDefinition(instance.widgetId, discoverLayout);
  const configuredServices = useConfiguredWidgetServices();
  const canConnect = useCan('settings.instances');
  const { ref, isNearViewport, hasEnteredViewport } = useNearViewport<HTMLDivElement>();

  if (!definition) {
    return (
      <div
        ref={ref}
        style={{
          fontSize: 11,
          color: HPR.fgSubtle,
          padding: 12,
          height: '100%',
          minHeight: 0,
        }}
      >
        Unknown widget: {instance.widgetId}
      </div>
    );
  }

  const servicesAvailable = hasRequiredWidgetServices(definition, configuredServices);
  const shouldMount = servicesAvailable && (editMode || hasEnteredViewport);
  const widgetActive = editMode || isNearViewport;
  const effectiveSecs = instance.refreshIntervalSecs ?? definition.defaultRefreshIntervalSecs;
  const widgetProps: WidgetProps = {
    refreshInterval: effectiveSecs * 1000,
    editMode,
    narrow,
    colSpan,
    rowSpan,
    layoutVariant,
    instanceId: instance.id,
    mobileGrid,
  };

  return (
    <div ref={ref} style={{ height: '100%', minHeight: 0 }}>
      {!servicesAvailable ? (
        <MissingServices
          services={describeRequiredWidgetServices(definition)}
          setupPath={canConnect && !editMode ? widgetServiceSetupPath(definition, configuredServices) : null}
          canConnect={canConnect}
        />
      ) : !shouldMount ? (
        <WidgetSkeleton rowSpan={rowSpan} />
      ) : (
        <WidgetVisibilityProvider active={widgetActive}>
          <UnavailableCover name={definition.name}>
          <WidgetWrapper
            widgetId={instance.id}
            onRetry={() => resetWidgetComponent(instance.widgetId)}
          >
            {() => {
              const WidgetComponent = getWidgetComponent(instance.widgetId);
              if (!WidgetComponent) {
                return (
                  <div
                    style={{
                      fontSize: 11,
                      color: HPR.fgSubtle,
                      padding: 12,
                    }}
                  >
                    Widget unavailable: {instance.widgetId}
                  </div>
                );
              }
              return (
                <Suspense fallback={<WidgetSkeleton rowSpan={rowSpan} />}>
                  {createElement(WidgetComponent, widgetProps)}
                </Suspense>
              );
            }}
          </WidgetWrapper>
          </UnavailableCover>
        </WidgetVisibilityProvider>
      )}
    </div>
  );
}

/** An empty widget leads an admin to the connection it needs, and tells a member who can fix it. */
function MissingServices({ services, setupPath, canConnect }: {
  services: string;
  setupPath: string | null;
  canConnect: boolean;
}) {
  const style = { fontSize: 11, color: HPR.fgSubtle, padding: 12 };
  // Short, so it fits the narrowest widget.
  if (!canConnect) return <div style={style}>Ask your admin to connect {services}</div>;
  if (!setupPath) return <div style={style}>Connect {services}</div>;
  return (
    // It fills the widget, so it stands for the widget: long-press and right-click still open its menu.
    <Link href={setupPath} data-context-menu-row style={{ ...style, display: 'block', height: '100%' }}>
      Connect {services} <span aria-hidden="true">→</span>
    </Link>
  );
}

/**
 * Offline, or with Helprr unreachable, a widget with nothing it can truthfully
 * show (no saved copy, or one past its five minutes) says so instead of
 * drawing its zeros and empty states as if they were real. The widget stays
 * mounted underneath, hidden, so its polling carries on and it reappears the
 * moment a load succeeds; with a saved copy it shows as usual, beside the
 * shared saved-data notice.
 */
function UnavailableCover({ name, children }: { name: string; children: ReactNode }) {
  const { unavailable, report } = useWidgetUnavailableReports();
  return (
    <WidgetUnavailableProvider report={report}>
      <div style={{ position: 'relative', height: '100%', minHeight: 0 }}>
        {/* visibility keeps the widget's size (it measures itself) and hides it from touch and screen readers. */}
        <div style={{ height: '100%', minHeight: 0, visibility: unavailable ? 'hidden' : undefined }}>
          {children}
        </div>
        {unavailable && (
          // EmptyState's look, sized for a one-cell phone widget too (about
          // 44×60 inside the card at 320): the name stays on one line, and
          // globals.css drops the icon and "right now." where they don't fit.
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
              <WifiOff size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
              <span
                style={{
                  flexShrink: 0,
                  color: HPR.fgMute,
                  fontWeight: 600,
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {name}
              </span>
              {unavailable === 'offline'
                ? <span>You&apos;re offline</span>
                : <span>Can’t reach Helprr<span className="widget-cover-tail"> right now.</span></span>}
            </div>
          </div>
        )}
      </div>
    </WidgetUnavailableProvider>
  );
}
