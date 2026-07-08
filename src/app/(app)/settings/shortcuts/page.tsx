'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ChevronLeft, Copy, Check, Share } from 'lucide-react';
import { toast } from 'sonner';
import { GroupedSection } from '@/components/settings/grouped-section';

interface Recipe {
  label: string;
  description: string;
  // Path appended to the host; keep <placeholders> for the user to fill in Shortcuts.
  path: string;
}

const emptySubscribe = () => () => {};
// SSR/first-render uses the placeholder; the client snapshot swaps in the real
// host on hydration (useSyncExternalStore avoids a hydration mismatch here).
const getOrigin = () => window.location.origin;
const getServerOrigin = () => 'https://your-helprr-host';

const RECIPES: Recipe[] = [
  {
    label: 'Add to watchlist',
    description: 'Save a TMDB item. Set type=tv for series, type=movie for films.',
    path: '/protocol?cmd=watchlist&tmdbId=<id>&type=tv',
  },
  {
    label: 'Request via Seerr',
    description: 'Create a Seerr request for a TMDB item.',
    path: '/protocol?cmd=request&tmdbId=<id>&type=movie',
  },
  {
    label: 'Search Discover',
    description: 'Open Discover with a query. Pair with “Ask for Input” for a voice “Search Helprr”.',
    path: '/protocol?cmd=discover&query=<text>',
  },
  {
    label: 'Open Calendar',
    description: 'Jump straight to upcoming releases.',
    path: '/calendar',
  },
  {
    label: 'Open Activity',
    description: 'Jump straight to the download queue and history.',
    path: '/activity',
  },
];

function RecipeRow({ recipe, origin }: { recipe: Recipe; origin: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${origin}${recipe.path}`;

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast.success('Link copied');
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => toast.error('Failed to copy'));
  }

  return (
    <div className="grouped-row flex-col items-stretch gap-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-medium">{recipe.label}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{recipe.description}</div>
        </div>
        <button
          onClick={copy}
          className="shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-foreground/5 active:bg-foreground/10 transition-colors text-muted-foreground"
          aria-label={`Copy ${recipe.label} URL`}
          title="Copy URL"
        >
          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <code className="block text-[11px] leading-relaxed text-muted-foreground bg-foreground/[0.04] rounded-md px-2.5 py-1.5 overflow-x-auto whitespace-nowrap">
        {url}
      </code>
    </div>
  );
}

export default function ShortcutsSettingsPage() {
  // Real host after hydration so copied URLs are ready to paste.
  const origin = useSyncExternalStore(emptySubscribe, getOrigin, getServerOrigin);

  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/settings/appearance"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Appearance & Layout
        </Link>
      </div>

      <div className="px-4 mb-4">
        <h1 className="text-2xl font-semibold">Siri Shortcuts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Drive Helprr from Apple’s Shortcuts app using its “Open URLs” action. Each recipe below
          opens the installed app and performs the action.
        </p>
      </div>

      <GroupedSection
        title="Before you start"
        footer="These shortcuts open the app to perform the action (foreground). They are not background Siri intents — true hands-free automation would need a native app wrapper."
      >
        <div className="grouped-row flex-col items-start gap-1.5 py-3">
          <p className="text-sm">
            Install Helprr to your Home Screen (Share <Share className="inline h-3.5 w-3.5 align-text-bottom" /> → Add to Home Screen) and stay signed in.
            URLs then open in the standalone app and carry your session.
          </p>
          <p className="text-sm">
            Use the <strong>https://</strong> links below rather than the <code className="text-xs">web+helprr://</code> scheme —
            iOS support for web-registered custom protocols in Shortcuts is inconsistent, but “Open URLs” on an https link reliably launches the installed PWA.
          </p>
        </div>
      </GroupedSection>

      <GroupedSection
        title="Recipes"
        footer="In Shortcuts: add an “Open URLs” action and paste a link. Replace <id> / <text>, or feed them from an “Ask for Input” / “Get Details” step."
      >
        {RECIPES.map((r) => (
          <RecipeRow key={r.label} recipe={r} origin={origin} />
        ))}
      </GroupedSection>

      <GroupedSection
        title="Share sheet"
        footer="Zero-config: no Shortcut needed."
      >
        <div className="grouped-row py-3">
          <p className="text-sm">
            Share a TMDB, IMDb, or TVDB link from any app into Helprr to add it — the app registers a
            share target, so it appears in the iOS share sheet once installed.
          </p>
        </div>
      </GroupedSection>
    </div>
  );
}
