import { FlaskConical } from 'lucide-react';
import { DEMO_PASSWORD, DEMO_USERNAME } from '@/lib/demo';

/**
 * Shown on every page of the local demo; on the sign-in page it also gives the account.
 * Its bottom margin is the page's top padding, which a flush page toolbar pulls itself up
 * by (.page-toolbar-flush), so the toolbar sits under the banner rather than over it.
 */
export function DemoBanner({ signIn = false }: { signIn?: boolean }) {
  return (
    <div role="note" className="mx-1 mb-[var(--main-pad-top)] flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-sm">
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
      <div className="min-w-0">
        <div className="font-medium text-amber-200">Demo: fake data. It resets when removed.</div>
        {signIn && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            Sign in as <span className="font-mono text-foreground">{DEMO_USERNAME}</span> with the password{' '}
            <span className="font-mono text-foreground break-all">{DEMO_PASSWORD}</span>.
          </div>
        )}
      </div>
    </div>
  );
}
