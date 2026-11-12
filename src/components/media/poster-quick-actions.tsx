'use client';

import { useRef, useState } from 'react';
import { Bell, Bookmark } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { WatchlistButton } from '@/components/watchlist/watchlist-button';
import type { WatchlistDraft } from '@/components/watchlist/watchlist-add-dialog';
import {
  ScheduledAlertButton,
  type ScheduledAlertDraft,
} from '@/components/scheduled-alerts/scheduled-alert-dialog';
import { cn } from '@/lib/utils';

// Posters sit in scrolling rails, which clip anything above the poster's top
// edge, so the 44px hit area hangs down from the control instead of being
// centred on it.
const HIT_AREA_DOWN = 'after:top-0 after:[transform:translateX(-50%)]';

/**
 * The watchlist and alert icons in a poster's corner. Two 44px hit areas don't
 * fit side by side on a phone-sized poster without one reaching the next
 * poster, so on touch screens the pair becomes one button that opens a menu
 * of both. With a mouse both icons stay as they are. A single icon keeps its
 * own full hit area everywhere.
 */
export function PosterQuickActions({
  watchlistDraft,
  scheduleDraft,
  watchlist,
  schedule,
  buttonClassName,
}: {
  watchlistDraft: WatchlistDraft;
  scheduleDraft: ScheduledAlertDraft;
  /** Show the watchlist action (the caller checks permission and library state). */
  watchlist: boolean;
  /** Show the alert action (the caller checks permission and library state). */
  schedule: boolean;
  /** Look of the watchlist icon, which the touch-screen menu button shares. */
  buttonClassName: string;
}) {
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const touchDown = useRef(false);
  const both = watchlist && schedule;

  return (
    <>
      {watchlist && (
        <WatchlistButton
          draft={watchlistDraft}
          variant="icon"
          hitArea={both ? 'height' : 'full'}
          className={cn(buttonClassName, both ? 'pointer-coarse:hidden' : HIT_AREA_DOWN)}
          open={watchlistOpen}
          onOpenChange={setWatchlistOpen}
        />
      )}
      {schedule && (
        <ScheduledAlertButton
          draft={scheduleDraft}
          variant="icon"
          hitArea={both ? 'height' : 'full'}
          className={cn('h-5 w-5', both ? 'pointer-coarse:hidden' : HIT_AREA_DOWN)}
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
        />
      )}
      {both && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Watchlist or alert"
              // The menu opens as a finger lands, which would pop it up when a
              // swipe of the poster rail starts here. A touch opens it on the
              // tap (click) instead; a mouse and the keyboard work as before.
              onPointerDown={(e) => {
                touchDown.current = e.pointerType !== 'mouse';
                if (touchDown.current) e.preventDefault();
              }}
              onClick={() => {
                if (touchDown.current) setMenuOpen((open) => !open);
                touchDown.current = false;
              }}
              className={cn(
                buttonClassName,
                'hidden pointer-coarse:inline-flex w-auto gap-1 px-1 relative touch-target',
                HIT_AREA_DOWN,
              )}
            >
              <Bookmark className="h-3 w-3" />
              <Bell className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          {/* Only touch screens open this menu: rows a finger can hit. */}
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="min-h-11" onSelect={() => setWatchlistOpen(true)}>
              <Bookmark className="h-4 w-4" />
              Add to watchlist…
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onSelect={() => setScheduleOpen(true)}>
              <Bell className="h-4 w-4" />
              Schedule alert…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
