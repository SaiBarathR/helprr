import { CollapsibleRow } from '@/components/media/collapsible-row';

type AlternateTitle = { title: string; seasonNumber?: number; sceneSeasonNumber?: number };

/**
 * The other names Sonarr/Radarr match releases against (foreign, romaji, scene
 * names), closed by default: a title can have dozens. Nothing when there are none.
 */
export function AlternateTitlesRow({ titles, className }: { titles: AlternateTitle[] | undefined; className?: string }) {
  const list = (titles ?? []).filter((entry) => typeof entry?.title === 'string' && entry.title.trim());
  if (list.length === 0) return null;
  return (
    <CollapsibleRow label="Alternative titles" summary={list.length} className={className}>
      <ul className="space-y-1.5">
        {list.map((entry, index) => {
          // Sonarr limits a scene name to one season with either number; -1 means every season.
          const season = [entry.seasonNumber, entry.sceneSeasonNumber].find((n) => typeof n === 'number' && n >= 0);
          return (
            <li key={`${entry.title}-${index}`} className="text-sm [overflow-wrap:anywhere]">
              {entry.title}
              {season !== undefined && <span className="text-muted-foreground"> · Season {season}</span>}
            </li>
          );
        })}
      </ul>
    </CollapsibleRow>
  );
}
