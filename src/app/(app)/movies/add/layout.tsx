import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function MoviesAddGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('movies.add');
  return <>{children}</>;
}
