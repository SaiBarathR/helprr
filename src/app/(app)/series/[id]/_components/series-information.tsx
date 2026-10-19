'use client';

import { Badge } from '@/components/ui/badge';
import { Pencil } from 'lucide-react';
import type { SeriesAniListResponse } from '@/types/anilist';
import { formatAniListMappingState } from './format';
import type { InfoRow } from './series-info';

/** The Information section: the series' rows, each season's details, and (for an admin) the AniList mapping. */
export function SeriesInformation({
  infoRows,
  seasonDetailRows,
  showAniListMapping,
  animeMapping,
  linkedSeasons,
  onEditMapping,
}: {
  infoRows: InfoRow[];
  seasonDetailRows: InfoRow[];
  showAniListMapping: boolean;
  animeMapping: SeriesAniListResponse['mapping'] | null;
  linkedSeasons: number;
  onEditMapping: () => void;
}) {
  return (
    <div className="mt-6 [grid-area:info]">
      <h2 className="text-lg font-bold mb-2">Information</h2>
      <div className="detail-info-rows space-y-0">
        {infoRows.map((row) => (
          <div key={row.label} className="flex justify-between py-2.5 border-b border-border/30 items-start">
            <span className="text-sm text-muted-foreground shrink-0">{row.label}</span>
            <span className="text-sm text-right ml-4 max-w-[60%] break-words">{row.value}</span>
          </div>
        ))}
        {seasonDetailRows.length > 0 && (
          <>
            <div className="pt-3 pb-1 text-xs uppercase tracking-wider text-muted-foreground">Season Details</div>
            {seasonDetailRows.map((row) => (
              <div key={row.label} className="flex justify-between py-2.5 border-b border-border/30 items-start">
                <span className="text-sm text-muted-foreground shrink-0">{row.label}</span>
                <span className="text-sm text-right ml-4 max-w-[60%] break-words">{row.value}</span>
              </div>
            ))}
          </>
        )}
        {showAniListMapping && (
          <button
            onClick={onEditMapping}
            className="flex justify-between items-center w-[calc(100%+1rem)] py-2.5 border-b border-border/30 -mx-2 px-2 rounded active:bg-muted/30"
          >
            <span className="text-sm text-muted-foreground">AniList</span>
            <span className="flex items-center gap-2 text-sm text-right">
              {formatAniListMappingState(animeMapping?.state)}
              {linkedSeasons > 1 ? ` · ${linkedSeasons} seasons` : ''}
              {animeMapping?.state === 'MANUAL_MATCH' ? (
                <Badge className="bg-green-600/90 text-foreground text-[10px] px-1.5 py-0">Manual</Badge>
              ) : animeMapping?.state === 'AUTO_MATCH' ? (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">Auto</Badge>
              ) : null}
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
