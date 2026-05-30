import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function SeriesAddGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('series.add');
  return <>{children}</>;
}
