'use client';

import type { ReactNode } from 'react';
import Link from '@/components/ui/app-link';
import { ArrowDownToLine, ChevronLeft, Command, Hand, MoveHorizontal, Search, Zap, type LucideIcon } from 'lucide-react';
import { GroupedSection } from '@/components/settings/grouped-section';
import { CategoryRow } from '@/components/settings/category-row';

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  );
}

function TipRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="grouped-row gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

export default function TipsSettingsPage() {
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
        <h1 className="text-2xl font-semibold">Tips &amp; gestures</h1>
        <p className="text-sm text-muted-foreground mt-1">Shortcuts that are easy to miss.</p>
      </div>

      <GroupedSection title="Touch gestures">
        <TipRow icon={Hand} label="Press and hold">
          Press and hold a poster, row or card for quick actions without opening it. With a mouse, right-click instead.
        </TipRow>
        <TipRow icon={MoveHorizontal} label="Swipe a row">
          Swipe rows in Notifications, Activity, Torrents and creator lists for actions like Read, Stop, Retry and Delete.
        </TipRow>
        <TipRow icon={ArrowDownToLine} label="Pull to refresh">
          Pull down at the top of a list to refresh it.
        </TipRow>
      </GroupedSection>

      <GroupedSection title="Search">
        <TipRow icon={Command} label="Open search">
          Tap Search in the navigation bar. On a computer, press <Kbd>⌘K</Kbd> (<Kbd>Ctrl K</Kbd> on Windows and Linux).
        </TipRow>
        <TipRow icon={Search} label="Search one place">
          Type a scope such as <Kbd>tm</Kbd> (TMDB), <Kbd>ani</Kbd> (AniList) or <Kbd>tor</Kbd> (Torrents), then
          press Tab or tap it. An empty search box lists every scope you can use.
        </TipRow>
      </GroupedSection>

      <GroupedSection title="Automation">
        <CategoryRow
          href="/settings/shortcuts"
          icon={Zap}
          iconBg="bg-amber-500/10"
          iconColor="text-amber-400"
          label="Siri Shortcuts"
          subtitle="Automate Helprr from the Shortcuts app"
        />
      </GroupedSection>
    </div>
  );
}
