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
  // Members reach detail pages here from other sections without discover.view, and for
  // them the Discover home page is not found.
  const canOpenHome = useCan('discover.view');
  return canOpenHome
    ? <SegmentError error={error} reset={reset} backHref="/discover" backLabel="Back to Discover" />
    : <SegmentError error={error} reset={reset} backHref="/" backLabel="Back to Helprr" />;
}
