import { assertPageAnyCapability } from '@/lib/page-guard';
import { ANIME_DETAIL_PAGE_CAPABILITIES } from '@/lib/capabilities';

export const dynamic = 'force-dynamic';

// Detail pages are opened from several sections; the Anime home, schedule and
// explore pages also need anime.view (their own page or layout checks it).
export default async function AnimeGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageAnyCapability(ANIME_DETAIL_PAGE_CAPABILITIES);
  return <>{children}</>;
}
