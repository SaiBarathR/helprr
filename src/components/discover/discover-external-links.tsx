import { ExternalLink } from 'lucide-react';

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
    <div>
      <h2 className="text-base font-semibold mb-2">External Links</h2>
      <div className="flex gap-2 flex-wrap">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/60 bg-accent/40 text-xs font-semibold"
          >
            {link.label}
            <ExternalLink className="h-3 w-3" />
          </a>
        ))}
      </div>
    </div>
  );
}
