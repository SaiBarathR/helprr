import { WatchModalProvider } from '@/components/jellyfin-streaming/cinematic/watch-modal';
import { CinematicHeader, CinematicPageHeading } from '@/components/jellyfin-streaming/cinematic/cinematic-header';

/**
 * Marks the Watch section for the cinematic skin, and hosts its chrome.
 *
 * The skin is a CSS scope rather than a prop threaded through eight pages:
 * `data-watch-skin` is stamped on <html> pre-paint (THEME_BOOTSTRAP_SCRIPT),
 * and `.hpr-watch` says *where* it applies. Both halves are present in the
 * server-rendered HTML, so the skin is correct on first paint.
 *
 * The header lives here rather than in the pages so it is the first thing on
 * every route. Pages used to render it themselves, which on the home page put
 * it below the billboard.
 */
export default function WatchLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="hpr-watch">
      <WatchModalProvider>
        <CinematicHeader />
        <CinematicPageHeading />
        {children}
      </WatchModalProvider>
    </div>
  );
}
