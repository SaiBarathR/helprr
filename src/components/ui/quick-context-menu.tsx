'use client';

import Link from 'next/link';
import {
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Loader2,
  RotateCw,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { closeOpenSwipeRow } from '@/components/ui/swipe-row';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';

export interface ContextAction {
  id: string;
  label: string;
  icon?: ReactNode;
  href?: string;
  external?: boolean;
  onNavigate?: () => void;
  onSelect?: () => void;
  disabled?: boolean;
  pending?: boolean;
  destructive?: boolean;
}

export interface ContextActionGroup {
  id?: string;
  actions: ContextAction[];
}

interface QuickContextMenuProps {
  children: ReactElement;
  label: string;
  actions?: ContextAction[];
  groups?: ContextActionGroup[];
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export interface OpenInNewTabTarget {
  href: string;
  external?: boolean;
}

interface HistoryNavState {
  canGoBack: boolean;
  canGoForward: boolean;
}

const INTERACTIVE_SELECTOR =
  'a,button,input,select,textarea,[contenteditable="true"],[role="button"],[data-context-menu-ignore]';

/** Prefer these action ids when choosing the "open in new tab" destination. */
const PRIMARY_OPEN_ACTION_IDS = new Set([
  'open',
  'open-details',
  'open-library',
  'go-to',
  'go-to-item',
  'view',
  'view-details',
]);

/** Prevents native text selection / iOS callout from fighting the long-press menu. */
const TRIGGER_GESTURE_CLASS =
  'select-none [-webkit-touch-callout:none] [-webkit-user-select:none]';

const TOOLBAR_ITEM_CLASS =
  'min-w-9 flex-1 justify-center px-1.5 py-1.5';

function clearTextSelection() {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) selection.removeAllRanges();
}

export function normalizeContextActionGroups(
  groups?: ContextActionGroup[],
  actions?: ContextAction[],
): ContextActionGroup[] {
  const source = groups ?? (actions ? [{ id: 'actions', actions }] : []);
  return source
    .map((group) => ({ ...group, actions: group.actions.filter(Boolean) }))
    .filter((group) => group.actions.length > 0);
}

export function countEnabledContextActions(groups: ContextActionGroup[]): number {
  return groups.reduce(
    (count, group) => count + group.actions.filter((action) => !action.disabled && !action.pending).length,
    0,
  );
}

/** Href on a Next.js Link / anchor trigger, when the pressed surface itself navigates. */
export function getTriggerHref(element: ReactElement): string | undefined {
  const href = (element.props as { href?: unknown }).href;
  return typeof href === 'string' && href.length > 0 ? href : undefined;
}

/**
 * Destination for "Open in new tab": primary open action href, else first
 * enabled href action, else the trigger's own href when it is a link.
 */
export function resolveOpenInNewTabTarget(
  groups: ContextActionGroup[],
  triggerHref?: string,
): OpenInNewTabTarget | null {
  const withHref = groups
    .flatMap((group) => group.actions)
    .filter((action): action is ContextAction & { href: string } => (
      typeof action.href === 'string'
      && action.href.length > 0
      && !action.disabled
      && !action.pending
    ));

  const primary = withHref.find((action) => PRIMARY_OPEN_ACTION_IDS.has(action.id));
  if (primary) return { href: primary.href, external: primary.external };

  const internal = withHref.find((action) => !action.external);
  if (internal) return { href: internal.href, external: false };

  if (withHref[0]) return { href: withHref[0].href, external: withHref[0].external };

  if (triggerHref) return { href: triggerHref };

  return null;
}

export function getHistoryNavState(): HistoryNavState {
  const navigation = (window as Window & {
    navigation?: { canGoBack?: boolean; canGoForward?: boolean };
  }).navigation;

  if (typeof navigation?.canGoBack === 'boolean' && typeof navigation.canGoForward === 'boolean') {
    return {
      canGoBack: navigation.canGoBack,
      canGoForward: navigation.canGoForward,
    };
  }

  return {
    canGoBack: window.history.length > 1,
    // Without the Navigation API we cannot know; keep forward available and
    // let history.forward() no-op when there is nowhere to go.
    canGoForward: true,
  };
}

export function resolveOpenInNewTabUrl(href: string): string {
  try {
    return new URL(href, window.location.origin).href;
  } catch {
    return href;
  }
}

function isNestedInteractiveTarget(target: EventTarget | null, currentTarget: EventTarget | null): boolean {
  if (!(target instanceof Element) || !(currentTarget instanceof Element) || target === currentTarget) return false;
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  return interactive !== null && interactive !== currentTarget && currentTarget.contains(interactive);
}

/**
 * Adds native-app style quick actions to one entity surface. Existing visible
 * controls remain the primary accessibility/discoverability path; this is an
 * additive right-click and touch/pen long-press affordance.
 */
export function QuickContextMenu({
  children,
  label,
  actions,
  groups,
  disabled = false,
  onOpenChange,
}: QuickContextMenuProps) {
  const normalizedGroups = useMemo(
    () => normalizeContextActionGroups(groups, actions),
    [actions, groups],
  );
  const enabledActionCount = countEnabledContextActions(normalizedGroups);
  const triggerHref = getTriggerHref(children);
  const openInNewTabTarget = useMemo(
    () => resolveOpenInNewTabTarget(normalizedGroups, triggerHref),
    [normalizedGroups, triggerHref],
  );
  const pointerTypeRef = useRef<string | null>(null);
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef(false);
  const selectGuardCleanupRef = useRef<(() => void) | null>(null);
  const menuOpenRef = useRef(false);
  const [nestedControlActive, setNestedControlActive] = useState(false);
  const [historyNav, setHistoryNav] = useState<HistoryNavState>({
    canGoBack: false,
    canGoForward: false,
  });

  const disarmSelectGuard = () => {
    selectGuardCleanupRef.current?.();
    selectGuardCleanupRef.current = null;
  };

  const armSelectGuard = () => {
    disarmSelectGuard();
    const preventSelect = (event: Event) => {
      event.preventDefault();
    };
    document.addEventListener('selectstart', preventSelect, true);
    selectGuardCleanupRef.current = () => {
      document.removeEventListener('selectstart', preventSelect, true);
    };
  };

  useEffect(() => () => {
    disarmSelectGuard();
  }, []);

  if (disabled || enabledActionCount < 2) return children;

  const handleOpenChange = (next: boolean) => {
    menuOpenRef.current = next;
    if (next) {
      closeOpenSwipeRow();
      setHistoryNav(getHistoryNavState());
      // Drop any native selection the long-press (or right-click) created so
      // the floating menu is not fighting a blue highlight / callout handles.
      clearTextSelection();
      if (pointerTypeRef.current === 'touch' || pointerTypeRef.current === 'pen') {
        suppressNextClickRef.current = true;
        haptic('light');
      }
    } else {
      pointerTypeRef.current = null;
      pointerOriginRef.current = null;
      disarmSelectGuard();
      clearTextSelection();
    }
    onOpenChange?.(next);
  };

  const stopIgnoredPointer = (event: ReactPointerEvent<HTMLElement>) => {
    // A new pointer gesture means any unconsumed synthetic-click guard from a
    // previous menu can be retired. Nested controls keep their complete event
    // lifecycle while temporarily disabling Radix's parent long-press timer.
    suppressNextClickRef.current = false;
    disarmSelectGuard();
    if (isNestedInteractiveTarget(event.target, event.currentTarget)) {
      setNestedControlActive(true);
      pointerTypeRef.current = null;
      pointerOriginRef.current = null;
      return;
    }
    pointerTypeRef.current = event.pointerType;
    pointerOriginRef.current = { x: event.clientX, y: event.clientY };
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      // Arm before the browser's long-press selection timer (~300–500ms).
      armSelectGuard();
      clearTextSelection();
    }
  };

  const trackPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const origin = pointerOriginRef.current;
    if (!origin) return;
    const deltaX = event.clientX - origin.x;
    const deltaY = event.clientY - origin.y;
    if ((deltaX * deltaX) + (deltaY * deltaY) > 100) {
      pointerTypeRef.current = null;
      pointerOriginRef.current = null;
      if (!menuOpenRef.current) disarmSelectGuard();
    }
  };

  const preserveLongPressThroughJitter = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.pointerType === 'touch' || event.pointerType === 'pen') && pointerOriginRef.current) {
      // Radix otherwise cancels on every pointermove, including normal
      // sub-pixel finger jitter. Preventing this small move skips only its
      // cancellation handler; movement beyond the threshold remains scrollable.
      event.preventDefault();
    }
  };

  const clearPointer = () => {
    pointerTypeRef.current = null;
    pointerOriginRef.current = null;
    setNestedControlActive(false);
    // If the menu already opened, keep blocking selection until it closes.
    // Otherwise release immediately so a normal tap does not leave the page
    // unable to select text.
    if (!menuOpenRef.current) disarmSelectGuard();
  };

  const runAction = (action: ContextAction) => {
    queueMicrotask(() => action.onSelect?.());
  };

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger
        asChild
        disabled={nestedControlActive}
        className={TRIGGER_GESTURE_CLASS}
        onPointerDownCapture={stopIgnoredPointer}
        onPointerMoveCapture={trackPointerMove}
        onPointerMove={preserveLongPressThroughJitter}
        onPointerUpCapture={clearPointer}
        onPointerCancelCapture={clearPointer}
        onContextMenuCapture={(event) => {
          // Keyboard-triggered context menus may not have a preceding pointer
          // event. Stop only this bubbling contextmenu event so the nested
          // control retains the browser default without losing click handlers.
          if (isNestedInteractiveTarget(event.target, event.currentTarget)) {
            event.stopPropagation();
            return;
          }
          if (pointerTypeRef.current === 'touch' || pointerTypeRef.current === 'pen') {
            clearTextSelection();
          }
        }}
        onClickCapture={(event) => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={label} collisionPadding={12} >
        {normalizedGroups.map((group, groupIndex) => (
          <ContextMenuGroup key={group.id ?? groupIndex}>
            {groupIndex > 0 && <ContextMenuSeparator />}
            {group.actions.map((action) => {
              const icon = action.pending ? <Loader2 className="animate-spin" /> : action.icon;
              const item = (
                <>
                  {icon}
                  <span className="min-w-0 truncate">{action.label}</span>
                </>
              );

              if (action.href) {
                const linkProps = action.external
                  ? { target: '_blank' as const, rel: 'noopener noreferrer' }
                  : {};
                return (
                  <ContextMenuItem
                    key={action.id}
                    asChild
                    disabled={action.disabled || action.pending}
                    variant={action.destructive ? 'destructive' : 'default'}
                  >
                    <Link
                      href={action.href}
                      {...linkProps}
                      onClick={(event) => {
                        event.stopPropagation();
                        action.onNavigate?.();
                      }}
                    >
                      {item}
                    </Link>
                  </ContextMenuItem>
                );
              }

              return (
                <ContextMenuItem
                  key={action.id}
                  disabled={action.disabled || action.pending}
                  variant={action.destructive ? 'destructive' : 'default'}
                  onSelect={(event) => {
                    event.stopPropagation();
                    runAction(action);
                  }}
                >
                  {item}
                </ContextMenuItem>
              );
            })}
          </ContextMenuGroup>
        ))}

        <ContextMenuSeparator />
        <div
          role="group"
          aria-label="Browser controls"
          data-context-toolbar
          className="flex items-stretch gap-0.5"
        >
          <ContextMenuItem
            className={TOOLBAR_ITEM_CLASS}
            disabled={!historyNav.canGoBack}
            aria-label="Back"
            title="Back"
            onSelect={() => {
              window.history.back();
            }}
          >
            <ArrowLeft />
          </ContextMenuItem>
          <ContextMenuItem
            className={TOOLBAR_ITEM_CLASS}
            disabled={!historyNav.canGoForward}
            aria-label="Forward"
            title="Forward"
            onSelect={() => {
              window.history.forward();
            }}
          >
            <ArrowRight />
          </ContextMenuItem>
          <ContextMenuItem
            className={TOOLBAR_ITEM_CLASS}
            aria-label="Reload"
            title="Reload"
            onSelect={() => {
              window.location.reload();
            }}
          >
            <RotateCw />
          </ContextMenuItem>
          {openInNewTabTarget && (
            <ContextMenuItem
              className={cn(TOOLBAR_ITEM_CLASS)}
              aria-label="Open in new tab"
              title="Open in new tab"
              onSelect={() => {
                window.open(
                  resolveOpenInNewTabUrl(openInNewTabTarget.href),
                  '_blank',
                  'noopener,noreferrer',
                );
              }}
            >
              <ExternalLink />
            </ContextMenuItem>
          )}
        </div>
      </ContextMenuContent>
    </ContextMenu>
  );
}
