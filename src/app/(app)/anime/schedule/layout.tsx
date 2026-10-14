import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function AnimeSectionGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('anime.view');
  return <>{children}</>;
}
