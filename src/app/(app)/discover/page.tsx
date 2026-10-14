import { assertPageCapability } from '@/lib/page-guard';
import DiscoverHome from './discover-home';

export default async function DiscoverPage() {
  await assertPageCapability('discover.view');
  return <DiscoverHome />;
}
