import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

// /api/library-gaps reads both libraries, so it requires both capabilities.
export default async function LibraryGapsGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('series.view');
  await assertPageCapability('movies.view');
  return <>{children}</>;
}
