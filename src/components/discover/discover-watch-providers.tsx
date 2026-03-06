'use client';

import Image from 'next/image';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { DiscoverWatchProviders, DiscoverWatchProviderEntry } from '@/types';

interface DiscoverWatchProvidersProps {
  providers: DiscoverWatchProviders;
}

function ProviderGroup({ label, entries }: { label: string; entries: DiscoverWatchProviderEntry[] }) {
  if (!entries.length) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1.5">{label}</p>
      <div className="flex gap-2 flex-wrap">
        {entries.map((p) => {
          const logoSrc = toCachedImageSrc(p.logoPath, 'tmdb') || p.logoPath;
          return (
            <div
              key={p.providerId}
              className="relative w-10 h-10 rounded-lg overflow-hidden bg-muted border border-border/40"
              title={p.providerName}
            >
              {logoSrc && (
                <Image
                  src={logoSrc}
                  alt={p.providerName}
                  fill
                  sizes="40px"
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
    <div className="px-4">
      <h2 className="text-base font-semibold mb-2">Where to Watch</h2>
      <div className="space-y-3">
        {providers.flatrate && <ProviderGroup label="Stream" entries={providers.flatrate} />}
        {providers.rent && <ProviderGroup label="Rent" entries={providers.rent} />}
        {providers.buy && <ProviderGroup label="Buy" entries={providers.buy} />}
      </div>
      {providers.link && (
        <a
          href={providers.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-2 text-xs text-primary font-medium"
        >
          View on JustWatch
        </a>
      )}
    </div>
  );
}
