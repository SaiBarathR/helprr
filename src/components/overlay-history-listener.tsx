'use client';

// Loads overlay-history with the root layout, on every page's first load, so
// its popstate listener is added before the app router's: listeners run in
// the order they were added, and it must see a Back first. From the (app)
// layout alone it could load later, after a client navigation into the app
// (the root page's redirect to the dashboard).
import '@/lib/overlay-history';

export function OverlayHistoryListener() {
  return null;
}
