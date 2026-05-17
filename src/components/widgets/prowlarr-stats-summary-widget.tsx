'use client';

import { useCallback } from 'react';
import { Database, Search, Download, XCircle } from 'lucide-react';
import type { WidgetProps } from '@/lib/widgets/types';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useWidgetFilter } from './use-widget-filter';
import { SectionHeader, StatTile, HPR } from './bento-primitives';
import { DaysPill, PROWLARR_DAYS_OPTIONS } from './widget-filter-controls';
import { fetchProwlarrStats, fmtNum } from './prowlarr-stats-shared';

interface Filters {
  days: number;
}

const DEFAULTS: Filters = { days: 30 };

export function ProwlarrStatsSummaryWidget({ refreshInterval, editMode = false, narrow = false }: WidgetProps) {
  const [filters, setFilters] = useWidgetFilter<Filters>('prowlarr-stats-summary', DEFAULTS);

  const fetchFn = useCallback(() => fetchProwlarrStats(filters.days), [filters.days]);
  const { data, loading } = useWidgetData({
    fetchFn,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `prowlarr-stats-${filters.days}d`,
  });

  const indexers = data?.indexers ?? [];
  const totalQueries = indexers.reduce((a, i) => a + i.numberOfQueries + i.numberOfRssQueries + i.numberOfAuthQueries, 0);
  const totalGrabs = indexers.reduce((a, i) => a + i.numberOfGrabs, 0);
  const totalFailed = indexers.reduce((a, i) => a + i.numberOfFailedQueries + i.numberOfFailedRssQueries, 0);

  const badge = (
    <DaysPill
      value={filters.days}
      options={PROWLARR_DAYS_OPTIONS}
      onChange={(days) => setFilters({ days })}
      disabled={editMode}
      narrow={narrow}
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <SectionHeader title="Prowlarr Stats" badge={badge} />
      {loading && indexers.length === 0 ? (
        <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 10,
            flex: 1,
          }}
        >
          <StatTile
            icon={<Database size={14} />}
            label="Indexers"
            value={fmtNum(indexers.length)}
            tone={HPR.cyan}
            narrow={narrow}
          />
          <StatTile
            icon={<Search size={14} />}
            label="Queries"
            value={fmtNum(totalQueries)}
            tone={HPR.violet}
            narrow={narrow}
          />
          <StatTile
            icon={<Download size={14} />}
            label="Grabs"
            value={fmtNum(totalGrabs)}
            tone={HPR.green}
            narrow={narrow}
          />
          <StatTile
            icon={<XCircle size={14} />}
            label="Failed"
            value={fmtNum(totalFailed)}
            tone={HPR.rose}
            narrow={narrow}
          />
        </div>
      )}
    </div>
  );
}
