'use client';

import { SegmentError } from '@/components/layout/segment-error';
import { useCan } from '@/components/permission-provider';

export default function SegmentErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Members reach detail pages here from other sections without anime.view, and for
  // them the Anime home page is not found.
  const canOpenHome = useCan('anime.view');
  return canOpenHome
    ? <SegmentError error={error} reset={reset} backHref="/anime" backLabel="Back to Anime" />
    : <SegmentError error={error} reset={reset} backHref="/" backLabel="Back to Helprr" />;
}
