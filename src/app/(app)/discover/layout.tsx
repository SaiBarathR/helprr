import { assertPageAnyCapability } from '@/lib/page-guard';
import { TMDB_TITLE_PAGE_CAPABILITIES } from '@/lib/capabilities';

export const dynamic = 'force-dynamic';

// Title, person and collection pages are opened from several sections; the
// Discover home page itself also needs discover.view (see page.tsx).
export default async function DiscoverGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageAnyCapability(TMDB_TITLE_PAGE_CAPABILITIES);
  return <>{children}</>;
}
