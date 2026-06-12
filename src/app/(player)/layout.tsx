import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/permissions';

// Minimal shell for the fullscreen player: no sidebar/nav, black edge-to-edge.
// Same server-side session check as (app)/layout.tsx — edge middleware only
// verifies the JWT, so revocation/disable must be enforced here.
export const dynamic = 'force-dynamic';

export default async function PlayerLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  if (!can(user, 'jellyfin.play')) {
    redirect('/dashboard');
  }

  return <div className="fixed inset-0 bg-black">{children}</div>;
}
