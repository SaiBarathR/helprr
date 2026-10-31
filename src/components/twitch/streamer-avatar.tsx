import { User } from 'lucide-react';
import { FadeInImage } from '@/components/media/fade-in-image';
import { toCachedImageSrc } from '@/lib/image';
import { cn } from '@/lib/utils';

export function StreamerAvatar({ url, size = 40, className }: { url: string | null | undefined; size?: number; className?: string }) {
  const src = toCachedImageSrc(url, undefined, { width: size * 2 });
  return (
    <span className={cn('relative block shrink-0 overflow-hidden rounded-full bg-muted', className)} style={{ width: size, height: size }}>
      {src ? (
        <FadeInImage src={src} alt="" fill sizes={`${size}px`} className="object-cover" unoptimized />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground"><User className="h-1/2 w-1/2" /></span>
      )}
    </span>
  );
}
