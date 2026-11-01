import { CreatorPage } from '@/components/creators/pages/creator-page';

export default function YoutubeChannelPage({ params }: { params: Promise<{ id: string }> }) {
  return <CreatorPage params={params} />;
}
