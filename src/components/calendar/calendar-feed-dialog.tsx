'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarPlus, Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { jsonFetcher } from '@/lib/query-fetch';
import type { FeedEventType, FeedFilters } from '@/lib/calendar-feed/filters';

interface FeedLink {
  id: string;
  name: string;
  /** Null when the stored filters are unreadable; such a link serves nothing. */
  filters: FeedFilters | null;
  createdAt: string;
  lastUsedAt: string | null;
}

interface FeedLinks {
  links: FeedLink[];
  max: number;
  /** The configured APP_ORIGIN, or null to use the address this page is on. */
  origin?: string | null;
}

const LINKS_KEY = ['calendar-feed-token'] as const;
const TYPE_LABEL: Record<FeedEventType, string> = { episode: 'Episodes', movie: 'Movies', album: 'Music' };
const ALL = 'all';

function ago(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : formatDistanceToNow(date, { addSuffix: true });
}

/**
 * The feed URL for this origin, and its webcal:// twin. The https link is the
 * one to share: some calendar apps fetch a webcal:// link over plain http. A
 * link's filters are stored with it, so the URL carries only the token.
 */
export function feedUrls(origin: string, token: string): { https: string; webcal: string } {
  const https = `${origin}/api/calendar/feed.ics?${new URLSearchParams({ token })}`;
  return { https, webcal: https.replace(/^https?:/, 'webcal:') };
}

/**
 * The person's calendar subscription links: several, each with a name and its own
 * filters (the new-link form starts from the Calendar page's). Helprr keeps only a
 * hash of each token, so a link is shown once, right after it is made.
 */
export function CalendarFeedDialog({
  open,
  onOpenChange,
  filters,
  instances,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FeedFilters;
  instances: Array<{ id: string; label: string }>;
}) {
  const queryClient = useQueryClient();
  // Tailwind's md starts at 768px: phones get the app's bottom sheet.
  const isPhone = useIsMobile(767);
  const status = useQuery({
    queryKey: LINKS_KEY,
    queryFn: jsonFetcher<FeedLinks>('/api/calendar/feed-token'),
    enabled: open,
  });
  // The token, held only while the dialog is mounted (the page mounts it only while open).
  const [made, setMade] = useState<{ name: string; token: string } | null>(null);
  const [name, setName] = useState(filters.type ? TYPE_LABEL[filters.type] : 'Calendar');
  const [draft, setDraft] = useState<FeedFilters>(filters);
  const [busy, setBusy] = useState(false);
  const [turningOff, setTurningOff] = useState<FeedLink | null>(null);

  const links = status.data?.links ?? [];
  const full = links.length >= (status.data?.max ?? Infinity);
  // The configured public origin when there is one, so a link made on a LAN
  // http address does not hand calendar apps an http link.
  const urls = made ? feedUrls(status.data?.origin || window.location.origin, made.token) : null;

  const describe = (shown: FeedFilters | null) => (!shown ? 'Shows nothing: its filters could not be read' : [
    shown.type ? TYPE_LABEL[shown.type] : 'Episodes, movies and music',
    shown.instanceId ? (instances.find((i) => i.id === shown.instanceId)?.label ?? 'One instance') : null,
    shown.monitoredOnly ? 'Monitored only' : null,
  ].filter(Boolean).join(' · '));

  async function makeLink() {
    setBusy(true);
    try {
      const res = await fetch('/api/calendar/feed-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), filters: draft }),
      });
      const body = (await res.json().catch(() => null)) as { token?: string; name?: string; error?: string } | null;
      if (!res.ok || !body?.token) throw new Error(body?.error ?? 'Failed to make the calendar link');
      setMade({ name: body.name ?? name.trim(), token: body.token });
      await queryClient.invalidateQueries({ queryKey: LINKS_KEY });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to make the calendar link');
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(link: FeedLink) {
    setBusy(true);
    try {
      const res = await fetch(`/api/calendar/feed-token/${encodeURIComponent(link.id)}`, { method: 'DELETE' });
      // Already gone (turned off on another device) is what was asked for.
      if (!res.ok && res.status !== 404) throw new Error(String(res.status));
      toast.success(`“${link.name}” turned off`);
      await queryClient.invalidateQueries({ queryKey: LINKS_KEY });
    } catch {
      toast.error('Failed to turn off the calendar link');
    } finally {
      setBusy(false);
      setTurningOff(null);
    }
  }

  async function copy() {
    if (!urls) return;
    try {
      await navigator.clipboard.writeText(urls.https);
      toast.success('Link copied');
    } catch {
      toast.error('Copy failed — select the link and copy it');
    }
  }

  const intro =
    'See your releases in Apple Calendar, Google Calendar or Outlook: the last 30 days and the next 6 months, kept up to date. Make one link per calendar, each showing what you pick.';
  // Focus the sheet itself on open: not the close button (a ring flashes on it
  // while the links load) and not the Name field (a phone's keyboard would cover the form).
  const focusSheet = (event: Event) => {
    event.preventDefault();
    (event.currentTarget as HTMLElement).focus();
  };

  const body = urls && made ? (
    <div className="space-y-3">
      <p className="text-sm font-medium">Your “{made.name}” link</p>
      <Input
        readOnly
        value={urls.https}
        aria-label="Calendar link"
        onFocus={(event) => event.currentTarget.select()}
        className="font-mono text-xs"
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" className="flex-1" onClick={copy}>
          <Copy className="mr-2 h-4 w-4" />
          Copy link
        </Button>
        <Button asChild variant="outline" className="flex-1">
          <a href={urls.webcal}>
            <CalendarPlus className="mr-2 h-4 w-4" />
            Open in Calendar app
          </a>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Keep this link private: anyone who has it can see your calendar. It is shown only now. Paste it
        into your calendar app&apos;s subscribe option (in Google Calendar, “From URL”). “Open in
        Calendar app” uses a webcal:// link, which some apps fetch over plain http; if yours does, use the
        copied link instead.
      </p>
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={() => setMade(null)}>Done</Button>
      </div>
    </div>
  ) : status.isPending ? (
    <div className="flex justify-center py-2">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  ) : status.isError ? (
    <p className="text-sm text-destructive">Couldn&apos;t load your calendar links.</p>
  ) : (
    <div className="space-y-5">
      {links.length > 0 && (
        <section aria-label="Your links" className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your links</p>
          <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
            {links.map((link) => {
              const madeAgo = ago(link.createdAt);
              const used = ago(link.lastUsedAt);
              return (
                <li key={link.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{link.name}</p>
                    <p className="text-xs text-muted-foreground">{describe(link.filters)}</p>
                    <p className="text-xs text-muted-foreground">
                      {madeAgo ? `Made ${madeAgo}` : 'Made'}{used ? `, last used ${used}` : ', not used yet'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    aria-label={`Turn off ${link.name}`}
                    onClick={() => setTurningOff(link)}
                  >
                    Turn off
                  </Button>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            Helprr doesn&apos;t keep the links themselves. To see one again, make a new one and turn the old
            one off.
          </p>
        </section>
      )}

      <section aria-label="New link" className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">New link</p>
        <div className="space-y-1.5">
          <Label htmlFor="calendar-feed-name">Name</Label>
          <Input
            id="calendar-feed-name"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Shows</Label>
            <Select
              value={draft.type ?? ALL}
              onValueChange={(value) => setDraft({ ...draft, type: value === ALL ? null : (value as FeedEventType) })}
            >
              <SelectTrigger aria-label="Shows" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Episodes, movies and music</SelectItem>
                {(Object.keys(TYPE_LABEL) as FeedEventType[]).map((type) => (
                  <SelectItem key={type} value={type}>{TYPE_LABEL[type]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(instances.length > 1 || draft.instanceId) && (
            <div className="space-y-1.5">
              <Label>Instance</Label>
              <Select
                value={draft.instanceId ?? ALL}
                onValueChange={(value) => setDraft({ ...draft, instanceId: value === ALL ? null : value })}
              >
                <SelectTrigger aria-label="Instance" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All instances</SelectItem>
                  {instances.map((instance) => (
                    <SelectItem key={instance.id} value={instance.id}>{instance.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <label className="flex items-center justify-between gap-3 text-sm">
          Monitored only
          <Switch
            aria-label="Monitored only"
            checked={draft.monitoredOnly}
            onCheckedChange={(monitoredOnly) => setDraft({ ...draft, monitoredOnly })}
          />
        </label>
        {full && (
          <p className="text-xs text-muted-foreground">
            You have {links.length} links, the most there can be. Turn one off to make another.
          </p>
        )}
        <div className="flex justify-end">
          <Button type="button" disabled={busy || full || !name.trim()} onClick={() => void makeLink()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Make link
          </Button>
        </div>
      </section>
    </div>
  );

  return (
    <>
      {isPhone ? (
        <Drawer open={open} onOpenChange={onOpenChange}>
          <DrawerContent size="content" className="outline-none" onOpenAutoFocus={focusSheet}>
            <DrawerHeader>
              <DrawerTitle>Subscribe in Calendar</DrawerTitle>
              <DrawerDescription>{intro}</DrawerDescription>
            </DrawerHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">{body}</div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto" onOpenAutoFocus={focusSheet}>
            <DialogHeader>
              <DialogTitle>Subscribe in Calendar</DialogTitle>
              <DialogDescription>{intro}</DialogDescription>
            </DialogHeader>
            {body}
          </DialogContent>
        </Dialog>
      )}

      <ConfirmDialog
        open={turningOff !== null}
        onOpenChange={(next) => !next && setTurningOff(null)}
        title={`Turn off “${turningOff?.name ?? ''}”?`}
        description="Calendars subscribed to this link stop updating. Your other links keep working."
        confirmLabel="Turn off"
        destructive
        busy={busy}
        onConfirm={() => (turningOff ? turnOff(turningOff) : undefined)}
      />
    </>
  );
}
