'use client';

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpRight } from 'lucide-react';
import { formatDistanceToNowSafe } from '@/lib/format';
import { FONT_MONO, HPR } from '@/components/widgets/bento-primitives';
import { EventIcon, getEventLabel, getEventHprColor } from './event-visuals';

export interface GroupedNotificationItem {
  body: string;
  redirect?: string;
  seasonNumber?: number;
  episodeId?: number;
}

export interface NotificationDetailRecord {
  id: string;
  eventType: string;
  title: string;
  body: string;
  metadata?: {
    source?: string;
    grouped?: boolean;
    groupCount?: number;
    items?: GroupedNotificationItem[];
  } | null;
  read: boolean;
  createdAt: string;
}

interface Props {
  notification: NotificationDetailRecord | null;
  onClose: () => void;
  onGoTo?: () => void;
  canGoTo?: boolean;
  /** Navigate to a single grouped item's deep link (closes the drawer first). */
  onNavigateItem?: (href: string) => void;
}

const SOURCE_LABELS: Record<string, string> = {
  sonarr: 'Sonarr',
  radarr: 'Radarr',
  qbittorrent: 'qBittorrent',
  jellyfin: 'Jellyfin',
};

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span
        className="shrink-0 text-[10px] uppercase tracking-wide"
        style={{ color: HPR.fgSubtle, fontFamily: FONT_MONO, minWidth: 72 }}
      >
        {label}
      </span>
      <span className="text-xs break-words" style={{ color: HPR.fg }}>
        {value}
      </span>
    </div>
  );
}

export function NotificationDetailDrawer({ notification, onClose, onGoTo, canGoTo, onNavigateItem }: Props) {
  const open = notification !== null;
  const color = notification ? getEventHprColor(notification.eventType) : HPR.fgMute;
  const label = notification ? getEventLabel(notification.eventType) : '';
  const sourceKey = notification?.metadata?.source;
  const sourceLabel = sourceKey ? (SOURCE_LABELS[sourceKey] ?? sourceKey) : null;
  const groupedItems =
    notification?.metadata?.grouped && Array.isArray(notification.metadata.items)
      ? notification.metadata.items
      : null;
  const groupCount = notification?.metadata?.groupCount ?? groupedItems?.length ?? 0;

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }} direction="bottom">
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center rounded p-1"
              style={{ background: `${color}1a`, color }}
            >
              {notification && <EventIcon type={notification.eventType} className="h-3.5 w-3.5" />}
            </span>
            <DrawerTitle className="text-sm font-medium break-words">
              {notification?.title}
            </DrawerTitle>
            <Badge
              variant="outline"
              className="ml-auto shrink-0 text-[10px]"
              style={{ color, borderColor: `${color}55` }}
            >
              {label}
            </Badge>
          </div>
          {notification && (
            <div className="text-[11px]" style={{ color: HPR.fgMute, fontFamily: FONT_MONO }}>
              {formatDistanceToNowSafe(notification.createdAt)} · {new Date(notification.createdAt).toLocaleString()}
            </div>
          )}
        </DrawerHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-4">
          {notification?.body && (
            <p
              className="text-sm leading-relaxed whitespace-pre-wrap break-words"
              style={{ color: HPR.fg }}
            >
              {notification.body}
            </p>
          )}

          {groupedItems && groupedItems.length > 0 && (
            <div>
              <div
                className="text-[10px] uppercase tracking-wide mb-1"
                style={{ color: HPR.fgSubtle, fontFamily: FONT_MONO }}
              >
                {groupCount} {groupCount === 1 ? 'item' : 'items'}
              </div>
              <div className="space-y-0.5">
                {groupedItems.map((item, i) => {
                  const href = item.redirect;
                  const seasonLabel =
                    typeof item.seasonNumber === 'number' ? `S${item.seasonNumber}` : null;
                  const inner = (
                    <>
                      <span
                        className="inline-flex items-center justify-center rounded p-1 mt-0.5 shrink-0"
                        style={{ background: `${color}1a`, color }}
                      >
                        {notification && <EventIcon type={notification.eventType} className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1 text-xs break-words" style={{ color: HPR.fg }}>
                        {item.body}
                      </span>
                      {seasonLabel && (
                        <span
                          className="shrink-0 text-[10px]"
                          style={{ color: HPR.fgMute, fontFamily: FONT_MONO }}
                        >
                          {seasonLabel}
                        </span>
                      )}
                      {href && onNavigateItem && (
                        <ArrowUpRight className="h-3 w-3 shrink-0" style={{ color: HPR.fgMute }} />
                      )}
                    </>
                  );
                  return href && onNavigateItem ? (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onNavigateItem(href)}
                      className="flex w-full items-start gap-2 py-1.5 text-left rounded transition-colors active:bg-white/5"
                    >
                      {inner}
                    </button>
                  ) : (
                    <div key={i} className="flex items-start gap-2 py-1.5">
                      {inner}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div
              className="text-[10px] uppercase tracking-wide mb-1"
              style={{ color: HPR.fgSubtle, fontFamily: FONT_MONO }}
            >
              Details
            </div>
            <Field label="Event" value={label} />
            <Field label="Source" value={sourceLabel} />
            <Field label="Status" value={notification ? (notification.read ? 'Read' : 'Unread') : null} />
            <Field
              label="Received"
              value={notification ? new Date(notification.createdAt).toLocaleString() : null}
            />
          </div>
        </div>

        {canGoTo && onGoTo && (
          <div className="px-4 pb-6 pt-1">
            <Button className="w-full h-11" onClick={onGoTo}>
              <ArrowUpRight className="mr-2 h-4 w-4" />
              Go to
            </Button>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
