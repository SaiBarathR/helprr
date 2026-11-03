import { CreatorPage } from '@/components/creators/pages/creator-page';

export default function TwitchStreamerPage({ params }: { params: Promise<{ id: string }> }) {
  return <CreatorPage params={params} />;
}
