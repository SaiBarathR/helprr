import { ArrowUpRight } from 'lucide-react';

interface ExternalLinkItem {
  label: string;
  url: string;
}

interface DiscoverExternalLinksProps {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  imdbId?: string | null;
  homepage?: string | null;
}

export function DiscoverExternalLinks({ tmdbId, mediaType, imdbId, homepage }: DiscoverExternalLinksProps) {
  const links: ExternalLinkItem[] = [];

  links.push({
    label: 'TMDB',
    url: `https://www.themoviedb.org/${mediaType}/${tmdbId}`,
  });

  if (imdbId) {
    links.push({
      label: 'IMDb',
      url: `https://www.imdb.com/title/${imdbId}`,
    });
  }

  if (homepage) {
    links.push({ label: 'Website', url: homepage });
  }

  if (!links.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="reel" aria-hidden />
        <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
          External Links
        </h2>
        <span className="hairline flex-1" aria-hidden />
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="press-feedback inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-[color:var(--hairline)] bg-card/40 hover:bg-card/70 hover:border-[color:var(--amber-soft)] transition-colors"
            style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
          >
            <span className="tracked-caps text-[9.5px]" style={{ letterSpacing: '0.22em' }}>
              {link.label}
            </span>
            <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
          </a>
        ))}
      </div>
    </div>
  );
}
