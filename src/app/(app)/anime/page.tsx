import { assertPageCapability } from '@/lib/page-guard';
import AnimeHome from './anime-home';

export default async function AnimePage() {
  await assertPageCapability('anime.view');
  return <AnimeHome />;
}
