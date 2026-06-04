import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function MusicAddGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('music.add');
  return <>{children}</>;
}
