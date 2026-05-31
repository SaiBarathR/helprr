import { assertPageAdmin } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function AnimeLibraryGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageAdmin();
  return <>{children}</>;
}
