'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMe } from '@/components/permission-provider';
import { useAppSettings } from '@/lib/hooks/use-app-settings';
import { DEFAULT_TORRENT_STALLED_ALERT_MINS, TORRENT_STALLED_ALERT_OPTIONS, formatStalledFor } from '@/lib/torrent-stalled-alert';

const TRIGGER_CLASS =
  'w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5';

const LABEL = 'Stalled for';

/**
 * How long a download must go without data (or metadata) before "Torrent
 * Stalled". It is one time for the whole server (the poller sends one push per
 * stall), so admins set it and everyone else sees it.
 */
export function TorrentStalledRow() {
  const { settings, loading, update } = useAppSettings();
  const isAdmin = useMe()?.role === 'admin';
  const minutes = settings?.torrentStalledAlertMins ?? DEFAULT_TORRENT_STALLED_ALERT_MINS;

  if (!isAdmin) {
    return (
      <div className="grouped-row">
        <span className="text-sm">{LABEL}</span>
        <span className="text-sm text-muted-foreground">{formatStalledFor(minutes)}</span>
      </div>
    );
  }

  return (
    <div className="grouped-row">
      <span className="text-sm">{LABEL}</span>
      <Select
        value={String(minutes)}
        onValueChange={(v) => void update({ torrentStalledAlertMins: parseInt(v, 10) })}
        disabled={loading}
      >
        <SelectTrigger aria-label={LABEL} className={TRIGGER_CLASS}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {/* A time saved outside the list (an imported file) is shown too. */}
          {[...new Set([...TORRENT_STALLED_ALERT_OPTIONS, minutes])].sort((a, b) => a - b).map((option) => (
            <SelectItem key={option} value={String(option)}>{formatStalledFor(option)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
