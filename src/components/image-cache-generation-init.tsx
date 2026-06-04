'use client';

import { setImageCacheGeneration } from '@/lib/image';

// Seeds the client bundle's image cache-busting token from the server-resolved
// generation. Rendered as the first child of the (app) layout so the module
// value is set before page components hydrate and build image URLs — keeping
// client-rendered src attributes identical to the server-rendered HTML.
export function ImageCacheGenerationInit({ value }: { value: number }) {
  setImageCacheGeneration(value);
  return null;
}
