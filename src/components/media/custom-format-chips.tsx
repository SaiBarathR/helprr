import { Badge } from '@/components/ui/badge';

/**
 * The custom formats a file matched, as chips after its CF score: the score
 * badge is the one interactive search shows on a release (neutral at 0, green
 * when positive, red when negative). Renders nothing when the file matched no
 * format and scores 0, which is every file on an instance without formats.
 */
export function CustomFormatChips({
  score,
  formats,
  className = '',
}: {
  score?: number;
  formats?: { id: number; name: string }[];
  className?: string;
}) {
  const named = (formats ?? []).filter((format) => format.name);
  const value = score ?? 0;
  if (named.length === 0 && value === 0) return null;
  const tone = value > 0
    ? 'text-emerald-500 border-emerald-500/40'
    : value < 0
      ? 'text-rose-500 border-rose-500/40'
      : 'text-muted-foreground';
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <Badge variant="outline" className={`text-[10px] tabular-nums ${tone}`}>
        CF {value > 0 ? `+${value}` : value}
      </Badge>
      {named.map((format) => (
        <Badge key={format.id} variant="secondary" className="text-[10px]">{format.name}</Badge>
      ))}
    </div>
  );
}
