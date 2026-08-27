import { WatchModalProvider } from '@/components/jellyfin-streaming/cinematic/watch-modal';

/**
 * Marks the Watch section for the cinematic skin, and hosts the detail overlay.
 *
 * The skin is a CSS scope rather than a prop threaded through eight pages:
 * `data-watch-skin` is stamped on <html> pre-paint (THEME_BOOTSTRAP_SCRIPT),
 * and `.hpr-watch` says *where* it applies. Both halves are present in the
 * server-rendered HTML, so the skin is correct on first paint — no flash, no
 * hydration mismatch.
 */
export default function WatchLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="hpr-watch">
      <WatchModalProvider>{children}</WatchModalProvider>
    </div>
  );
}
