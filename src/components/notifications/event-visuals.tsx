import { createElement, type CSSProperties } from 'react';
import {
  Bell,
  Check,
  Download,
  X,
  AlertTriangle,
  Clock,
  Trash2,
  Play,
  Newspaper,
  type LucideIcon,
} from 'lucide-react';
import { EVENT_META, type NotificationEventType } from '@/lib/notification-events';

const ICON_MAP: Record<NotificationEventMetaIconName, LucideIcon> = {
  Download, Check, X, AlertTriangle, Clock, Trash2, Play, Bell, Newspaper,
};

type NotificationEventMetaIconName = (typeof EVENT_META)[NotificationEventType]['iconName'];

// HPR palette colour per icon, so semantics survive (success=green, failure=rose, etc.)
const HPR_COLOR_BY_ICON: Record<NotificationEventMetaIconName, string> = {
  Download: 'var(--hpr-blue)',
  Check: 'var(--hpr-green)',
  X: 'var(--hpr-rose)',
  AlertTriangle: 'var(--hpr-amber)',
  Clock: 'var(--hpr-purple)',
  Play: 'var(--hpr-violet)',
  Trash2: 'var(--hpr-fgMute)',
  Bell: 'var(--hpr-amber)',
  Newspaper: 'var(--hpr-cyan)',
};

export function getEventIcon(type: string): LucideIcon {
  const meta = EVENT_META[type as NotificationEventType];
  return meta ? ICON_MAP[meta.iconName] : Bell;
}

export function EventIcon({ type, className, style }: { type: string; className?: string; style?: CSSProperties }) {
  return createElement(getEventIcon(type), { className, style });
}

export function getEventLabel(type: string): string {
  return EVENT_META[type as NotificationEventType]?.label ?? 'Notification';
}

export function getEventColorClass(type: string): string {
  return EVENT_META[type as NotificationEventType]?.colorClass ?? 'bg-muted text-muted-foreground';
}

export function getEventHprColor(type: string): string {
  const meta = EVENT_META[type as NotificationEventType];
  return meta ? HPR_COLOR_BY_ICON[meta.iconName] : 'var(--hpr-fgMute)';
}
