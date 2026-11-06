'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from '@/components/ui/app-link';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { GroupedSection } from '@/components/settings/grouped-section';
import { WhatsNewDialog } from '@/components/whats-new/whats-new-dialog';
import type { WhatsNew } from '@/lib/whats-new';
import { APP_VERSION, GIT_SHA } from '@/lib/app-version';
import { PRIVACY_URL } from '@/lib/docs-links';

const SOURCE_URL = 'https://github.com/SaiBarathR/helprr';

// The exact notice TMDB's API terms ask every app to show with its logo.
const TMDB_NOTICE = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

function LinkRow({ href, label, subtitle }: { href: string; label: string; subtitle: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="grouped-row hover:bg-foreground/[0.03] active:bg-foreground/5 transition-colors"
    >
      <div className="min-w-0 flex-1 pr-3">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
      </div>
      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
    </a>
  );
}

function CreditRow({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="grouped-row grouped-row-stacked gap-0.5">
      <div className="text-sm font-medium">{name}</div>
      <div className="text-xs text-muted-foreground">{children}</div>
    </div>
  );
}

export default function AboutSettingsPage() {
  const [notes, setNotes] = useState<WhatsNew | null>(null);
  const [notesError, setNotesError] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  // Loaded on first open; a failed load is tried again on the next open.
  const openNotes = () => {
    setNotesOpen(true);
    if (notes) return;
    setNotesError(false);
    fetch('/api/whats-new?current=1', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<WhatsNew>;
      })
      .then(setNotes)
      .catch(() => setNotesError(true));
  };

  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Settings
        </Link>
      </div>

      <div className="px-4 mb-4">
        <h1 className="text-2xl font-semibold">About</h1>
      </div>

      <GroupedSection>
        <div className="grouped-row items-center">
          <div className="flex items-center gap-3 min-w-0 flex-1 pr-3">
            <Image src="/icons/icon-192.png" alt="" width={48} height={48} unoptimized className="h-12 w-12 shrink-0 rounded-xl" />
            <div className="min-w-0">
              <div className="text-[17px] font-semibold">Helprr</div>
              <div className="text-xs text-muted-foreground mt-0.5">Self-hosted media dashboard</div>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-sm">{APP_VERSION}</div>
            {GIT_SHA && (
              <div className="text-xs text-muted-foreground font-mono">{GIT_SHA.slice(0, 7)}</div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={openNotes}
          className="grouped-row w-full text-left hover:bg-foreground/[0.03] active:bg-foreground/5 transition-colors"
        >
          <div className="min-w-0 flex-1 pr-3">
            <div className="text-sm font-medium">What&apos;s new</div>
            <div className="text-xs text-muted-foreground mt-0.5">Release notes for this version</div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
        <div className="grouped-row">
          <div className="min-w-0 flex-1 text-sm">License</div>
          <div className="shrink-0 text-sm text-muted-foreground">GPL-3.0</div>
        </div>
        <LinkRow href={SOURCE_URL} label="Source code" subtitle="GitHub repository" />
        <LinkRow href={PRIVACY_URL} label="Privacy" subtitle="No telemetry, and every request Helprr makes" />
      </GroupedSection>

      <GroupedSection title="Credits">
        <div className="grouped-row grouped-row-stacked gap-2">
          <Image src="/images/tmdb-logo.svg" alt="TMDB" width={108} height={14} className="h-3.5 w-auto self-start" />
          <div className="text-xs text-muted-foreground">
            Movie and TV data and images come from{' '}
            <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
              The Movie Database (TMDB)
            </a>
            . {TMDB_NOTICE}
          </div>
        </div>
        <CreditRow name="AniList">
          Anime data comes from the{' '}
          <a href="https://anilist.co" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
            AniList
          </a>{' '}
          API.
        </CreditRow>
        <CreditRow name="Jellyfin">
          Library and playback data comes from your own{' '}
          <a href="https://jellyfin.org" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
            Jellyfin
          </a>{' '}
          server.
        </CreditRow>
        <CreditRow name="Twitch and YouTube">
          Channel and video details come from Twitch and YouTube when an administrator sets them up. Helprr is
          not affiliated with or endorsed by either.
        </CreditRow>
      </GroupedSection>

      <WhatsNewDialog notes={notes} error={notesError} open={notesOpen} onOpenChange={setNotesOpen} />
    </div>
  );
}
