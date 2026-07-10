'use client';

import Link from 'next/link';
import { ApiError } from '@/lib/query-fetch';
import { toCachedImageSrc } from '@/lib/image';
import { formatDistanceToNowShort } from '@/lib/format';
import type { WidgetProps } from '@/lib/widgets/types';
import type { LibraryGapItem, LibraryGapSectionId, LibraryGapsResponse } from '@/types';
import { COUNT_META, COUNT_ORDER } from '@/components/insights/library-gaps-card';
import { InsightsWidgetFrame } from './insights-widget-frame';
import { useWidgetFilter } from './use-widget-filter';
import {
  Eyebrow,
  FONT_MONO,
  HPR,
  Pill,
  Poster,
  toneFromString,
} from './bento-primitives';

type SectionFilter = 'all' | LibraryGapSectionId;

async function fetchLibraryGaps(signal?: AbortSignal): Promise<LibraryGapsResponse> {
  const res = await fetch('/api/library-gaps', { signal });
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  return res.json();
}

/**
 * The actual gap ITEMS behind the library-completeness gauge — missing
 * seasons, collection gaps, overdue episodes, and upcoming/unreleased media,
 * filterable by section. Read-only: rows deep-link into the library; search
 * actions live on /library-gaps.
 */
export function LibraryGapsWidget({ refreshInterval, editMode = false }: WidgetProps) {
  const [filters, setFilters] = useWidgetFilter<{ section: SectionFilter }>('library-gaps', {
    section: 'all',
  });

  return (
    <InsightsWidgetFrame<LibraryGapsResponse>
      title="Library Gaps"
      right={
        <Link href="/library-gaps" style={{ color: 'inherit', textDecoration: 'none' }}>
          <span className="@max-[219px]/cell:hidden">View all </span>→
        </Link>
      }
      refreshInterval={refreshInterval}
      editMode={editMode}
      fetchFn={fetchLibraryGaps}
      cacheKey="library-gaps-items"
      isEmpty={(data) =>
        !data || !data.sections.some((s) => s.available && s.items.length > 0)
      }
      emptyMessage="No gaps — your library is complete."
    >
      {(data) => {
        const available = COUNT_ORDER
          .map((id) => data.sections.find((s) => s.id === id))
          .filter((s): s is NonNullable<typeof s> => !!s && s.available);
        const shown = filters.section === 'all'
          ? available.filter((s) => s.items.length > 0)
          : available.filter((s) => s.id === filters.section);
        const totalCount = available.reduce((sum, s) => sum + s.count, 0);

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
            <div
              className="no-scrollbar"
              style={{ display: 'flex', gap: 4, overflowX: 'auto', flexShrink: 0, paddingBottom: 2 }}
              role="group"
              aria-label="Gap section"
            >
              <SectionChip
                active={filters.section === 'all'}
                color={HPR.amber}
                disabled={editMode}
                onClick={() => setFilters({ section: 'all' })}
              >
                All {totalCount > 0 ? totalCount : ''}
              </SectionChip>
              {available.map((s) => (
                <SectionChip
                  key={s.id}
                  active={filters.section === s.id}
                  color={COUNT_META[s.id].color}
                  disabled={editMode}
                  onClick={() => setFilters({ section: s.id })}
                >
                  {COUNT_META[s.id].label} {s.count > 0 ? s.count : ''}
                </SectionChip>
              ))}
            </div>

            {shown.length === 0 ? (
              <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>
                Nothing in this section.
              </div>
            ) : (
              shown.map((section) => (
                <div key={section.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {filters.section === 'all' && (
                    <Eyebrow>{COUNT_META[section.id].label}</Eyebrow>
                  )}
                  {section.items.map((item) => (
                    <GapRow key={item.key} item={item} editMode={editMode} />
                  ))}
                  {section.count > section.items.length && (
                    <div style={{ fontSize: 10, color: HPR.fgSubtle, paddingLeft: 2 }}>
                      +{section.count - section.items.length} more on the full page
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        );
      }}
    </InsightsWidgetFrame>
  );
}

function SectionChip({
  active,
  color,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  color: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      aria-pressed={active}
      style={{ background: 'none', border: 'none', padding: 0, cursor: disabled ? 'default' : 'pointer' }}
    >
      <Pill color={active ? color : HPR.fgMute} ghost={!active}>
        {children}
      </Pill>
    </button>
  );
}

function GapRow({ item, editMode }: { item: LibraryGapItem; editMode: boolean }) {
  const posterSrc = item.poster ? toCachedImageSrc(item.poster) ?? item.poster : null;
  const row = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: 6,
        background: HPR.ink,
        borderRadius: 10,
      }}
    >
      <Poster
        width={32}
        height={48}
        label={item.title}
        tone={toneFromString(item.title)}
        fontSize={7}
        imageUrl={posterSrc ?? undefined}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            color: HPR.fg,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {item.title}
        </div>
        {(item.subtitle || item.collectionTitle) && (
          <div
            style={{
              fontSize: 11,
              color: HPR.fgMute,
              marginTop: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {item.subtitle ?? item.collectionTitle}
          </div>
        )}
      </div>
      {item.date && (
        <div
          className="@max-[219px]/cell:hidden"
          style={{ fontSize: 10, color: HPR.fgSubtle, fontFamily: FONT_MONO, flexShrink: 0 }}
        >
          {formatDistanceToNowShort(item.date)}
        </div>
      )}
    </div>
  );

  if (editMode || !item.href) return row;

  return (
    <Link href={item.href} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      {row}
    </Link>
  );
}
