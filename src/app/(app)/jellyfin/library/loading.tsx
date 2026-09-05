import { Skeleton } from '@/components/ui/skeleton';

/**
 * The Watch section's route fallback.
 *
 * Every other section of the app has one of these; this one did not, and the
 * cost was not cosmetic. Without a boundary the router has to finish rendering
 * the whole next route before it can commit, so tapping a tab left the *old*
 * page on screen — measured at 2.7s to 8.4s on a phone, with the route's own
 * JavaScript already downloaded 200ms in and the main thread idle for the rest.
 * Nothing told the viewer the tap had registered. With a boundary the router
 * commits this immediately and fills it in behind.
 *
 * The shapes are deliberate rather than generic bars: the hero reserves the
 * height the real billboard takes, so the rails are laid out where they will
 * stay instead of starting at the top and being shoved down when the hero
 * arrives. Sizes track the card ladder in `cinematic-card` and the hero heights
 * in `cinematic-hero` and `watch-hero`, and are pure CSS because a `loading.tsx`
 * is a server component and cannot measure the viewport: portrait cards on a
 * phone, landscape from `md` up, matching what each layout actually renders.
 */

const CARD = 'shrink-0 w-[112px] sm:w-[132px] md:w-[220px] lg:w-[240px] xl:w-[262px] 2xl:w-[292px]';
const CARD_ART = 'aspect-2/3 md:aspect-video w-full rounded-xl';

function Rail({ label }: { label: string }) {
  return (
    <section className="space-y-2" aria-hidden>
      <Skeleton className="h-5 w-40" aria-label={label} />
      <div className="flex gap-2 overflow-hidden md:gap-3">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className={CARD}>
            <Skeleton className={CARD_ART} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function WatchLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      <span className="sr-only">Loading</span>
      {/* Holds the billboard's ground so nothing below it moves when it lands. */}
      <Skeleton className="h-[62vh] max-h-[42rem] min-h-[22rem] w-full rounded-3xl" />
      <Rail label="row" />
      <Rail label="row" />
      <Rail label="row" />
    </div>
  );
}
