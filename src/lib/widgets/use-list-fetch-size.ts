'use client';

import { useMemo } from 'react';
import { SECTION_HEADER_HEIGHT } from '@/components/widgets/bento-primitives';

interface UseListFetchSizeOptions {
  /** Live element height from useElementSize. 0 before first measure. */
  height: number;
  /** Pixel height of a single row in the list. */
  rowHeight: number;
  /** Vertical space the section header takes inside the widget. */
  headerHeight?: number;
  /** Extra rows beyond what's strictly visible, so the user has scroll headroom. */
  bufferRows?: number;
  /** Snap fetch size up to the next multiple of this so resizing within a
   *  bucket doesn't bust the network cache. */
  bucketSize?: number;
  /** Floor for visibleCount before the buffer is added, used pre-measure. */
  minVisible?: number;
}

interface UseListFetchSizeResult {
  visibleCount: number;
  fetchSize: number;
}

export function useListFetchSize({
  height,
  rowHeight,
  headerHeight = SECTION_HEADER_HEIGHT,
  bufferRows = 8,
  bucketSize = 20,
  minVisible = 6,
}: UseListFetchSizeOptions): UseListFetchSizeResult {
  return useMemo(() => {
    const visibleCount =
      height > 0
        ? Math.max(minVisible, Math.ceil((height - headerHeight) / rowHeight) + bufferRows)
        : minVisible + bufferRows;
    const fetchSize = Math.max(bucketSize, Math.ceil(visibleCount / bucketSize) * bucketSize);
    return { visibleCount, fetchSize };
  }, [height, rowHeight, headerHeight, bufferRows, bucketSize, minVisible]);
}
