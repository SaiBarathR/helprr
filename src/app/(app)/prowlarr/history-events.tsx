import { Download, Info, KeyRound, Rss, Search, XCircle, type LucideIcon } from 'lucide-react';

/** Prowlarr's history event names (its HistoryEventType enum, camelCased by the API). */
const HISTORY_EVENTS: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  releaseGrabbed: { label: 'Grab', icon: Download, color: 'text-green-400' },
  indexerQuery: { label: 'Search', icon: Search, color: 'text-blue-400' },
  indexerRss: { label: 'RSS', icon: Rss, color: 'text-amber-400' },
  indexerAuth: { label: 'Auth', icon: KeyRound, color: 'text-violet-400' },
  indexerInfo: { label: 'Info', icon: Info, color: 'text-muted-foreground' },
};

/** A short name for the event; an event Prowlarr adds later shows as sent. */
export function historyEventLabel(eventType: string): string {
  return HISTORY_EVENTS[eventType]?.label ?? eventType;
}

/**
 * A failure is any event with `successful: false` (Prowlarr has no failed event
 * type), so it shows as failed whatever the event was.
 */
export function HistoryEventIcon({ eventType, successful }: { eventType: string; successful?: boolean }) {
  const event = HISTORY_EVENTS[eventType];
  const Icon = successful === false ? XCircle : event?.icon ?? Search;
  const color = successful === false ? 'text-rose-400' : event?.color ?? 'text-blue-400';
  return <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} aria-label={successful === false ? 'Failed' : undefined} />;
}
