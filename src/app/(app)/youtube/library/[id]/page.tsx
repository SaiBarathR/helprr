import { CreatorFilePage } from '@/components/creators/pages/file-page';

export default function YoutubeFilePage({ params }: { params: Promise<{ id: string }> }) {
  return <CreatorFilePage params={params} />;
}
