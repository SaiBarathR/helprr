// @vitest-environment jsdom
import type { ImgHTMLAttributes } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: function MockImage({ fill, priority, unoptimized, alt, ...props }: ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    priority?: boolean;
    unoptimized?: boolean;
  }) {
    void fill;
    void priority;
    void unoptimized;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt ?? ''} {...props} />;
  },
}));

import { HeroImage } from '../hero-image';

describe('HeroImage', () => {
  it('renders nothing once its source fails, and tries a new source', () => {
    const { container, rerender } = render(<HeroImage src="/api/image?src=a" alt="Masterplan" fill />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('');

    rerender(<HeroImage src="/api/image?src=b" alt="Tenzing" fill />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/image?src=b');
  });

  it('still calls the caller\'s onError', () => {
    const onError = vi.fn();
    const { container } = render(<HeroImage src="/api/image?src=a" alt="" fill onError={onError} />);
    fireEvent.error(container.querySelector('img')!);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
