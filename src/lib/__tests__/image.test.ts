import { describe, expect, it } from 'vitest';
import {
  RESPONSIVE_IMAGE_WIDTH_BUCKETS,
  selectResponsiveImageWidth,
  setProtectedImageWidth,
  toCachedImageSrc,
  toProtectedImageSrcSet,
} from '@/lib/image';

describe('protected image helpers', () => {
  it('keeps responsive image widths in the protected bucket set', () => {
    expect(RESPONSIVE_IMAGE_WIDTH_BUCKETS).toEqual([160, 240, 320, 480, 640]);
    expect(selectResponsiveImageWidth(1)).toBe(160);
    expect(selectResponsiveImageWidth(239)).toBe(240);
    expect(selectResponsiveImageWidth(481)).toBe(640);
    expect(selectResponsiveImageWidth(1200)).toBe(640);
  });

  it('preserves proxy auth/cache parameters while changing only the transform width', () => {
    const src = toCachedImageSrc('https://s4.anilist.co/file/poster.jpg', 'anilist', { width: 600 });
    expect(src).toBe('/api/image?src=https%3A%2F%2Fs4.anilist.co%2Ffile%2Fposter.jpg&service=anilist&w=600');

    expect(setProtectedImageWidth(`${src}&v=7`, 241))
      .toBe('/api/image?src=https%3A%2F%2Fs4.anilist.co%2Ffile%2Fposter.jpg&service=anilist&w=320&v=7');
  });

  it('generates browser-selectable srcset candidates for protected proxy URLs only', () => {
    const src = '/api/image?src=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Foriginal%2Fposter.jpg&service=tmdb&v=3';
    expect(toProtectedImageSrcSet(src)).toBe(
      '/api/image?src=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Foriginal%2Fposter.jpg&service=tmdb&v=3&w=160 160w, '
      + '/api/image?src=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Foriginal%2Fposter.jpg&service=tmdb&v=3&w=240 240w, '
      + '/api/image?src=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Foriginal%2Fposter.jpg&service=tmdb&v=3&w=320 320w, '
      + '/api/image?src=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Foriginal%2Fposter.jpg&service=tmdb&v=3&w=480 480w, '
      + '/api/image?src=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Foriginal%2Fposter.jpg&service=tmdb&v=3&w=640 640w',
    );
    expect(toProtectedImageSrcSet('https://image.tmdb.org/t/p/original/poster.jpg')).toBeUndefined();
  });
});
