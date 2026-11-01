import { CreatorFilePage } from '@/components/creators/pages/file-page';

export default function TwitchFilePage({ params }: { params: Promise<{ id: string }> }) {
  return <CreatorFilePage params={params} />;
}
