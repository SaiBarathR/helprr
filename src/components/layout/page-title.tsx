import type { ReactNode } from 'react';

/**
 * A top-level page's title, for screen readers only. The owner does not want a visible
 * title on top-level pages: the tab bar or sidebar already shows where you are, and the
 * space belongs to the content. Never make this visible.
 */
export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="sr-only">{children}</h1>;
}
