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
    <div>
      <h2 className="text-base font-semibold mb-2">{title}</h2>
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-2 px-2 md:-mx-6 md:px-6 scrollbar-hide">
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
              className="group shrink-0 w-[220px] sm:w-[260px]"
            >
              <div className="relative aspect-video rounded-lg overflow-hidden bg-muted border border-border/40">
                {thumbnailUrl && (
                  <Image
                    src={thumbnailUrl}
                    alt={video.name}
                    fill
                    sizes="260px"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    unoptimized
                  />
                )}
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/40 transition-colors">
                  <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
                    <Play className="h-5 w-5 text-black fill-black ml-0.5" />
                  </div>
                </div>
              </div>
              <p className="text-[11px] font-medium mt-1.5 line-clamp-1 leading-tight">{video.name}</p>
              <p className="text-[10px] text-muted-foreground">{video.type}</p>
            </a>
          );
        })}
      </div>
    </div>
  );
}
