'use client';

import { SegmentError } from '@/components/layout/segment-error';

export default function SegmentErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SegmentError error={error} reset={reset} backHref="/series" backLabel="Back to Series" />;
}
