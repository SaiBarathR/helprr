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
      <p className="tracked-mid text-[10px] text-muted-foreground mb-2">{label}</p>
      <div className="flex gap-2 flex-wrap">
        {entries.map((p) => {
          const logoSrc = toCachedImageSrc(p.logoPath, 'tmdb') || p.logoPath;
          return (
            <div
              key={p.providerId}
              className="relative w-10 h-10 rounded-lg overflow-hidden bg-muted/40 border border-foreground/[0.08]"
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

  const fellBack = providers.region !== providers.requestedRegion;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-base font-semibold">Where to Watch</h2>
        <span className="tracked-caps text-[10px] text-muted-foreground">
          {providers.region}
          {fellBack && (
            <span className="ml-1 text-muted-foreground/70 normal-case tracking-normal font-normal">
              · not in {providers.requestedRegion}
            </span>
          )}
        </span>
      </div>
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
          className="inline-block mt-3 text-xs text-primary font-medium hover:underline underline-offset-4"
        >
          View on JustWatch
        </a>
      )}
    </div>
  );
}
