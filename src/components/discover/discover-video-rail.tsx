import Image from 'next/image';
import { Play } from 'lucide-react';
import type { DiscoverVideo } from '@/types';

interface DiscoverVideoRailProps {
  title: string;
  videos: DiscoverVideo[];
}

export function DiscoverVideoRail({ title, videos }: DiscoverVideoRailProps) {
  if (!videos.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="reel" aria-hidden />
        <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
          {title} · Trailers
        </h2>
        <span className="hairline flex-1" aria-hidden />
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-2 px-2 md:-mx-6 md:px-6 scrollbar-hide animate-rail-in">
        {videos.map((video) => {
          const thumbnailUrl = video.site === 'YouTube'
            ? `https://img.youtube.com/vi/${video.key}/mqdefault.jpg`
            : null;
          const videoUrl = video.site === 'YouTube'
            ? `https://www.youtube.com/watch?v=${video.key}`
            : null;

          if (!videoUrl) return null;

          return (
            <a
              key={video.id}
              href={videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group press-feedback shrink-0 w-[240px] sm:w-[280px]"
            >
              <div
                className="relative aspect-video overflow-hidden bg-muted/40 transition-all duration-500 group-hover:shadow-[0_18px_38px_-18px_var(--amber-glow)]"
                style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
              >
                <div
                  aria-hidden
                  className="absolute inset-0 z-20 pointer-events-none"
                  style={{ borderRadius: 'inherit', border: '1px solid var(--hairline)' }}
                />
                {thumbnailUrl && (
                  <Image
                    src={thumbnailUrl}
                    alt={video.name}
                    fill
                    sizes="280px"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                    unoptimized
                  />
                )}
                <div className="absolute inset-0 bg-[color:var(--ink-deep)]/40 group-hover:bg-[color:var(--ink-deep)]/30 transition-colors" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div
                    className="w-11 h-11 rounded-full bg-[color:var(--amber)] text-[color:var(--primary-foreground)] flex items-center justify-center transition-transform group-hover:scale-110"
                    style={{ boxShadow: '0 0 0 4px oklch(0 0 0 / 0.3), 0 0 20px var(--amber-glow)' }}
                  >
                    <Play className="h-4 w-4 fill-current ml-0.5" />
                  </div>
                </div>
                <span
                  className="absolute bottom-1.5 left-1.5 tracked-caps text-[8.5px] px-1 py-0.5 bg-black/65 text-white/90 border border-white/10 backdrop-blur-sm"
                  style={{ borderRadius: '3px', letterSpacing: '0.2em' }}
                >
                  {video.type}
                </span>
              </div>
              <p className="font-display text-[12.5px] mt-2 line-clamp-1 leading-tight" style={{ letterSpacing: '-0.01em' }}>
                {video.name}
              </p>
            </a>
          );
        })}
      </div>
    </div>
  );
}
