import type { EpisodeFinaleType, MovieReleaseType } from '@/types';

const RELEASE_TYPE_CONFIG: Record<MovieReleaseType, { label: string; cls: string }> = {
  cinema: { label: 'Cinema', cls: 'bg-rose-500/15 text-rose-400' },
  physical: { label: 'Physical', cls: 'bg-amber-500/15 text-amber-400' },
  digital: { label: 'Digital', cls: 'bg-cyan-500/15 text-cyan-400' },
};

const FINALE_TYPE_CONFIG: Record<EpisodeFinaleType, { label: string; cls: string }> = {
  series: { label: 'Series Finale', cls: 'bg-red-500/15 text-red-400' },
  season: { label: 'Season Finale', cls: 'bg-amber-500/15 text-amber-400' },
  midseason: { label: 'Midseason Finale', cls: 'bg-muted text-muted-foreground' },
};

export function ReleaseTypeBadge({ type, className = '' }: { type: MovieReleaseType; className?: string }) {
  const { label, cls } = RELEASE_TYPE_CONFIG[type];
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide shrink-0 ${cls} ${className}`}
    >
      {label}
    </span>
  );
}

export function FinaleBadge({ type, className = '' }: { type: EpisodeFinaleType; className?: string }) {
  const { label, cls } = FINALE_TYPE_CONFIG[type];
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide shrink-0 ${cls} ${className}`}
    >
      {label}
    </span>
  );
}

const MONTH_BORDER: Record<MovieReleaseType | EpisodeFinaleType, string> = {
  cinema: 'border-l-rose-400',
  physical: 'border-l-amber-400',
  digital: 'border-l-cyan-400',
  series: 'border-l-red-400',
  season: 'border-l-amber-400',
  midseason: 'border-l-muted-foreground',
};

export function getMonthBorderClass(key: MovieReleaseType | EpisodeFinaleType | undefined): string {
  if (!key) return '';
  return `border-l-2 ${MONTH_BORDER[key]}`;
}
