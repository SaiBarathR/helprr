'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarPlus, Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { jsonFetcher } from '@/lib/query-fetch';
import { feedQuery, type FeedFilters } from '@/lib/calendar-feed/filters';

interface FeedStatus {
  active: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
}

const STATUS_KEY = ['calendar-feed-token'] as const;
const TYPE_LABEL = { episode: 'Episodes', movie: 'Movies', album: 'Music' } as const;

function ago(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : formatDistanceToNow(date, { addSuffix: true });
}

/** The feed URL for this origin, and its webcal:// twin for Apple Calendar. */
export function feedUrls(origin: string, token: string, filters: FeedFilters): { https: string; webcal: string } {
  const https = `${origin}/api/calendar/feed.ics?${feedQuery(token, filters)}`;
  return { https, webcal: https.replace(/^https?:/, 'webcal:') };
}

/**
 * Make, renew or turn off the person's calendar subscription link. The link
 * carries the Calendar page's current filters. Helprr keeps only a hash of the
 * token, so the link is shown once, right after it is made.
 */
export function CalendarFeedDialog({
  open,
  onOpenChange,
  filters,
  instanceLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FeedFilters;
  instanceLabel?: string;
}) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: jsonFetcher<FeedStatus>('/api/calendar/feed-token'),
    enabled: open,
  });
  // The token, held only while the dialog is mounted (the page mounts it only while open).
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'renew' | 'off' | null>(null);

  const active = status.data?.active ?? false;
  const urls = token ? feedUrls(window.location.origin, token, filters) : null;
  const shows = [
    filters.type ? TYPE_LABEL[filters.type] : 'Episodes, movies and music',
    filters.instanceId ? (instanceLabel ?? 'One instance') : null,
    filters.monitoredOnly ? 'Monitored only' : null,
  ].filter(Boolean).join(' · ');

  async function makeLink() {
    setBusy(true);
    try {
      const res = await fetch('/api/calendar/feed-token', { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { token: string };
      setToken(body.token);
      await queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    } catch {
      toast.error('Failed to make the calendar link');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const res = await fetch('/api/calendar/feed-token', { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
      setToken(null);
      toast.success('Calendar link turned off');
      await queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    } catch {
      toast.error('Failed to turn off the calendar link');
    } finally {
      setBusy(false);
      setConfirm(null);
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

  const made = ago(status.data?.createdAt ?? null);
  const used = ago(status.data?.lastUsedAt ?? null);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Subscribe in Calendar</DialogTitle>
            <DialogDescription>
              See your releases in Apple Calendar, Google Calendar or Outlook: the last 30 days and the next
              6 months, kept up to date.
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm">
            <span className="text-muted-foreground">Shows: </span>
            {shows}
          </p>

          {status.isPending ? (
            <div className="flex justify-center py-2">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : status.isError ? (
            <p className="text-sm text-destructive">Couldn&apos;t load your calendar link.</p>
          ) : urls ? (
            <div className="space-y-3">
              <Input
                readOnly
                value={urls.https}
                aria-label="Calendar link"
                onFocus={(event) => event.currentTarget.select()}
                className="font-mono text-xs"
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button asChild className="flex-1">
                  <a href={urls.webcal}>
                    <CalendarPlus className="mr-2 h-4 w-4" />
                    Add to Calendar
                  </a>
                </Button>
                <Button type="button" variant="outline" className="flex-1" onClick={copy}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy link
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Keep this link private: anyone who has it can see your calendar. It is shown only now. For
                Google Calendar, copy it into “From URL”.
              </p>
            </div>
          ) : active ? (
            <p className="text-sm text-muted-foreground">
              Your calendar link is on{made ? `, made ${made}` : ''}{used ? `, last used ${used}` : ', not used yet'}.
              Helprr doesn&apos;t keep the link itself, so to see it again make a new one; the old one then stops
              working.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Make a private link that your calendar app checks for new releases.
            </p>
          )}

          {!status.isPending && !status.isError && (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {active && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirm('off')}>
                  Turn off
                </Button>
              )}
              <Button
                type="button"
                variant={urls ? 'outline' : 'default'}
                disabled={busy}
                onClick={() => (active ? setConfirm('renew') : void makeLink())}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {active ? 'Make new link' : 'Make link'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(next) => !next && setConfirm(null)}
        title={confirm === 'off' ? 'Turn off the calendar link?' : 'Make a new calendar link?'}
        description={
          confirm === 'off'
            ? 'Calendars subscribed to it stop updating.'
            : 'The current link stops working, so calendars subscribed to it stop updating until you subscribe again.'
        }
        confirmLabel={confirm === 'off' ? 'Turn off' : 'Make new link'}
        destructive={confirm === 'off'}
        busy={busy}
        onConfirm={confirm === 'off' ? turnOff : makeLink}
      />
    </>
  );
}
