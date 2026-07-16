'use client';

import {
  MonitorSmartphone,
  Tv,
  Smartphone,
  Laptop,
  Copy,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { timeAgo, formatDateTime } from '@/lib/jellyfin-helpers';
import type { JellyfinDevice } from '@/types/jellyfin';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';

// Resolve via an object lookup (not a function returning a component) so the
// chosen glyph is a stable reference, matching the codebase's icon-map pattern.
const DEVICE_GLYPHS = {
  tv: Tv,
  phone: Smartphone,
  laptop: Laptop,
  device: MonitorSmartphone,
} satisfies Record<string, LucideIcon>;

async function copyDeviceId(device: JellyfinDevice): Promise<void> {
  try {
    await navigator.clipboard.writeText(device.Id);
    toast.success('Device ID copied');
  } catch {
    toast.error('Could not copy device ID');
  }
}

/** Pick a device glyph key from the device/app name. */
export function deviceGlyphKey(name: string): keyof typeof DEVICE_GLYPHS {
  const n = name.toLowerCase();
  if (/(tv|roku|shield|chromecast|appletv|fire tv|firetv|webos|tizen|kodi)/.test(n)) return 'tv';
  if (/(iphone|ipad|android|phone|pixel|galaxy|mobile)/.test(n)) return 'phone';
  if (/(mac|windows|linux|firefox|chrome|edge|safari|web|desktop|browser|pc)/.test(n)) return 'laptop';
  return 'device';
}

interface DeviceItemProps {
  device: JellyfinDevice;
  variant: 'card' | 'row';
  isSelf?: boolean;
  /** When provided (and not self), renders a delete button. */
  onDelete?: (device: JellyfinDevice) => void;
}

export function DeviceItem({ device, variant, isSelf = false, onDelete }: DeviceItemProps) {
  const Icon = DEVICE_GLYPHS[deviceGlyphKey(`${device.Name} ${device.AppName ?? ''}`)];
  const title = device.CustomName || device.Name;
  const app = [device.AppName, device.AppVersion].filter(Boolean).join(' ');

  const SelfBadge = (
    <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-[var(--hpr-cyan)] border-[var(--hpr-cyan)]/30 shrink-0">
      This server
    </Badge>
  );
  const DeleteBtn = onDelete && (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 shrink-0"
      aria-label={`Delete ${title}`}
      onClick={() => onDelete(device)}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
  const actions = [
    {
      id: 'copy-id',
      label: 'Copy device ID',
      icon: <Copy />,
      onSelect: () => { void copyDeviceId(device); },
    },
    ...(!isSelf && onDelete ? [{
      id: 'delete',
      label: 'Delete device',
      icon: <Trash2 />,
      destructive: true,
      onSelect: () => onDelete(device),
    }] : []),
  ];

  if (variant === 'card') {
    return (
      <QuickContextMenu label={`${title} device actions`} actions={actions}>
        <div className="snap-start shrink-0 w-[200px] rounded-xl bg-card p-3 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="rounded-lg bg-[var(--hpr-cyan)]/10 p-2"><Icon className="h-4 w-4 text-[var(--hpr-cyan)]" /></div>
          {isSelf ? SelfBadge : DeleteBtn}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          <p className="text-xs text-muted-foreground truncate">{app || 'Unknown app'}</p>
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground mt-auto">
          <span className="truncate">{device.LastUserName || '—'}</span>
          {device.DateLastActivity && <span className="shrink-0">{timeAgo(device.DateLastActivity)}</span>}
        </div>
        </div>
      </QuickContextMenu>
    );
  }

  return (
    <QuickContextMenu label={`${title} device actions`} actions={actions}>
      <div className="rounded-xl bg-card p-3 flex items-center gap-3">
        <div className="rounded-lg bg-[var(--hpr-cyan)]/10 p-2"><Icon className="h-4 w-4 text-[var(--hpr-cyan)]" /></div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          <p className="text-xs text-muted-foreground truncate">
            {app || 'Unknown app'}{device.LastUserName && ` · ${device.LastUserName}`}
          </p>
        </div>
        {device.DateLastActivity && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(device.DateLastActivity)}</span>
        )}
        {isSelf ? SelfBadge : DeleteBtn}
      </div>
    </QuickContextMenu>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</p>
      <p className="text-xs truncate">{value || '—'}</p>
    </div>
  );
}

interface DevicesSeeAllDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  devices: JellyfinDevice[];
  selfDeviceId: string;
  /** When provided, each deletable device gets a delete button + a Delete All action. */
  onDelete?: (device: JellyfinDevice) => void;
  onDeleteAll?: () => void;
}

export function DevicesSeeAllDrawer({
  open,
  onOpenChange,
  devices,
  selfDeviceId,
  onDelete,
  onDeleteAll,
}: DevicesSeeAllDrawerProps) {
  const deletableCount = devices.filter((d) => d.Id !== selfDeviceId).length;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <DrawerTitle className="text-sm">Devices ({devices.length})</DrawerTitle>
            {onDeleteAll && deletableCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] gap-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                onClick={onDeleteAll}
              >
                <Trash2 className="h-3 w-3" />
                Delete All
              </Button>
            )}
          </div>
        </DrawerHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6 space-y-2">
          {devices.map((device) => {
            const Icon = DEVICE_GLYPHS[deviceGlyphKey(`${device.Name} ${device.AppName ?? ''}`)];
            const isSelf = device.Id === selfDeviceId;
            return (
              <QuickContextMenu
                key={device.Id}
                label={`${device.CustomName || device.Name} device actions`}
                actions={[
                  {
                    id: 'copy-id',
                    label: 'Copy device ID',
                    icon: <Copy />,
                    onSelect: () => { void copyDeviceId(device); },
                  },
                  ...(!isSelf && onDelete ? [{
                    id: 'delete',
                    label: 'Delete device',
                    icon: <Trash2 />,
                    destructive: true,
                    onSelect: () => onDelete(device),
                  }] : []),
                ]}
              >
              <div className="rounded-xl bg-muted/40 p-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-[var(--hpr-cyan)]/10 p-2"><Icon className="h-4 w-4 text-[var(--hpr-cyan)]" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{device.CustomName || device.Name}</p>
                    <p className="text-xs text-muted-foreground truncate">{device.Name}</p>
                  </div>
                  {isSelf ? (
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-[var(--hpr-cyan)] border-[var(--hpr-cyan)]/30 shrink-0">This server</Badge>
                  ) : onDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 shrink-0"
                      aria-label={`Delete ${device.CustomName || device.Name}`}
                      onClick={() => onDelete(device)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3 pl-1">
                  <DetailField label="App" value={device.AppName} />
                  <DetailField label="Version" value={device.AppVersion} />
                  <DetailField label="User" value={device.LastUserName} />
                  <DetailField label="Last active" value={device.DateLastActivity ? formatDateTime(device.DateLastActivity) : undefined} />
                </div>
              </div>
              </QuickContextMenu>
            );
          })}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
