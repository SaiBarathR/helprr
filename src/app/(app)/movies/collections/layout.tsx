import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function MoviesCollectionsGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('movies.view');
  return <>{children}</>;
}
