'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { parseNotes } from '@/lib/changelog';
import type { WhatsNew } from '@/lib/whats-new';
import { formatDate as formatDisplayDate } from '@/lib/date-format';

export const CHANGELOG_URL = 'https://github.com/SaiBarathR/helprr/blob/main/CHANGELOG.md';

// **bold**, `code` and [links](https://…), the only inline markup the changelog uses.
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{part.slice(1, -1)}</code>;
    }
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (link) {
      return (
        <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
          {link[1]}
        </a>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function formatDate(date: string | null): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  // Noon UTC keeps the day the same in every time zone.
  return formatDisplayDate(`${date}T12:00:00Z`, { day: 'numeric', month: 'short', year: 'numeric' });
}

function ReleaseBody({ body }: { body: string }) {
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      {parseNotes(body).map((block, index) => {
        if (block.type === 'heading') {
          return (
            <div key={index} className="pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
              {block.text}
            </div>
          );
        }
        if (block.type === 'paragraph') return <p key={index}>{renderInline(block.text)}</p>;
        return (
          <ul key={index} className="list-disc space-y-1.5 pl-5">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className={item.depth ? 'ml-4 list-[circle]' : undefined}>
                {renderInline(item.text)}
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

export function WhatsNewDialog({
  notes,
  error = false,
  open,
  onOpenChange,
}: {
  /** null while loading. */
  notes: WhatsNew | null;
  error?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const releases = notes?.releases ?? [];
  let status: string | null = null;
  if (error) status = 'Could not load the release notes. Check the connection and try again.';
  else if (!notes) status = 'Loading…';
  else if (releases.length === 0) status = 'There are no release notes for this build.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Title and Done stay put; only the notes scroll (they can run long on a phone). */}
      <DialogContent className="flex flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{notes ? `What's new in ${notes.version}` : "What's new"}</DialogTitle>
          <DialogDescription>
            {releases.length > 1
              ? `Changes in the ${notes?.omitted ? 'latest ' : ''}${releases.length} releases since you last looked.`
              : 'Changes in this release.'}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6">
          {status && <p className="text-sm text-muted-foreground">{status}</p>}
          {releases.map((release) => (
            <section key={release.version} className="space-y-1">
              {releases.length > 1 && (
                <h3 className="text-sm font-semibold">
                  {release.version}
                  {formatDate(release.date) && <span className="font-normal text-muted-foreground"> · {formatDate(release.date)}</span>}
                </h3>
              )}
              <ReleaseBody body={release.body} />
            </section>
          ))}
          {notes && notes.omitted > 0 && (
            <p className="text-sm text-muted-foreground">
              {notes.omitted === 1 ? 'One earlier release is' : `${notes.omitted} earlier releases are`} in the full changelog.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" asChild>
            <a href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer">
              Full changelog
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shows the notes once after an update; closing it marks that version seen on every device. */
export function WhatsNewOnUpdate() {
  const [notes, setNotes] = useState<WhatsNew | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/whats-new', { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<WhatsNew>) : null))
      .then((data) => {
        if (cancelled || !data || data.releases.length === 0) return;
        setNotes(data);
        setOpen(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next || !notes) return;
    void fetch('/api/whats-new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: notes.version }),
      keepalive: true,
    }).catch(() => {});
  };

  return <WhatsNewDialog notes={notes} open={open} onOpenChange={handleOpenChange} />;
}
