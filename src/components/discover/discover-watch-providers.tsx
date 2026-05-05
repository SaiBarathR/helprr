'use client';

import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { DiscoverWatchProviders, DiscoverWatchProviderEntry } from '@/types';

interface DiscoverWatchProvidersProps {
  providers: DiscoverWatchProviders;
}

function ProviderGroup({ label, entries }: { label: string; entries: DiscoverWatchProviderEntry[] }) {
  if (!entries.length) return null;
  return (
    <div className="space-y-2">
      <p className="tracked-caps text-[8.5px] text-muted-foreground/80" style={{ letterSpacing: '0.24em' }}>
        {label} · {entries.length}
      </p>
      <div className="flex gap-1.5 flex-wrap">
        {entries.map((p) => {
          const logoSrc = toCachedImageSrc(p.logoPath, 'tmdb') || p.logoPath;
          return (
            <div
              key={p.providerId}
              className="relative w-11 h-11 overflow-hidden bg-muted/30"
              style={{ borderRadius: 'calc(var(--radius) - 2px)', boxShadow: '0 0 0 1px var(--hairline)' }}
              title={p.providerName}
            >
              {logoSrc && (
                <Image
                  src={logoSrc}
                  alt={p.providerName}
                  fill
                  sizes="44px"
                  className="object-cover"
                  unoptimized={isProtectedApiImageSrc(logoSrc)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DiscoverWatchProvidersSection({ providers }: DiscoverWatchProvidersProps) {
  const hasAny = (providers.flatrate?.length || 0) + (providers.rent?.length || 0) + (providers.buy?.length || 0) > 0;
  if (!hasAny) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="reel" aria-hidden />
        <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
          Where to Watch
        </h2>
        <span className="hairline flex-1" aria-hidden />
      </div>
      <div className="space-y-3.5">
        {providers.flatrate && <ProviderGroup label="Stream" entries={providers.flatrate} />}
        {providers.rent && <ProviderGroup label="Rent" entries={providers.rent} />}
        {providers.buy && <ProviderGroup label="Buy" entries={providers.buy} />}
      </div>
      {providers.link && (
        <a
          href={providers.link}
          target="_blank"
          rel="noopener noreferrer"
          className="press-feedback inline-flex items-center gap-1.5 mt-1 tracked-caps text-[9.5px] text-[color:var(--amber)] hover:underline"
        >
          View on JustWatch
          <ArrowUpRight className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
