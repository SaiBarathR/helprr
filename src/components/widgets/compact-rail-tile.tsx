'use client';

import type { CSSProperties } from 'react';
import Link from '@/components/ui/app-link';
import { Check } from 'lucide-react';
import { Eyebrow, HPR, Poster, toneFromString } from './bento-primitives';

const ellipsis: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

export interface CompactRailItem {
  href: string;
  title: string;
  meta: string;
  /** Short coloured tags after the meta (an upcoming film's PHY / DIG / CIN). */
  tags?: { label: string; color: string }[];
  imageUrl?: string | null;
  inLibrary?: boolean;
}

/**
 * A poster rail in a one-row, half-width phone cell (2×1). Under a full header
 * that cell leaves about 30px, which cut titles to their first word and clipped
 * the 72px posters, and at 320px the header wraps and leaves nothing. Like the
 * watchlist widget's count tile, it takes a small label instead, which links to
 * the full list (when there is one), and shows the top title whole. With no
 * title to show, `note` says why (loading, nothing yet, offline) on one line.
 */
export function CompactRailTile({
  title,
  viewAllHref,
  item,
  note,
  editMode = false,
}: {
  title: string;
  viewAllHref?: string;
  item: CompactRailItem | null;
  note?: string;
  editMode?: boolean;
}) {
  const row = item && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <Poster width={24} height={36} tone={toneFromString(item.title)} imageUrl={item.imageUrl ?? undefined} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, lineHeight: '17px', fontWeight: 500, color: HPR.fg, ...ellipsis }}>{item.title}</div>
        {item.tags?.length ? (
          // Whole parts on one line: a tag that doesn't fit wraps onto a second
          // line the fixed height hides, rather than the line ending in "…".
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 4, height: 15, overflow: 'hidden', fontSize: 11, lineHeight: '15px', color: HPR.fgMute }}>
            <span style={{ maxWidth: '100%', ...ellipsis }}>{item.meta}</span>
            {item.tags.map((tag) => (
              <span key={tag.label} style={{ color: tag.color, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em' }}>{tag.label}</span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11, lineHeight: '15px', color: HPR.fgMute, ...ellipsis }}>{item.meta}</div>
        )}
      </div>
      {item.inLibrary && (
        <div
          role="img"
          aria-label="In library"
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: HPR.green,
            color: HPR.ink,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Check size={11} strokeWidth={3} />
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, height: '100%', minHeight: 0 }}>
      {viewAllHref ? (
        <Link
          href={viewAllHref}
          aria-label={`${title}, view all`}
          className="relative touch-target"
          style={{ alignSelf: 'flex-start', maxWidth: '100%', textDecoration: 'none' }}
        >
          <Eyebrow style={ellipsis}>{title} →</Eyebrow>
        </Link>
      ) : (
        <Eyebrow style={ellipsis}>{title}</Eyebrow>
      )}
      {!row && note && (
        <div style={{ fontSize: 11, lineHeight: '15px', color: HPR.fgSubtle, ...ellipsis }}>{note}</div>
      )}
      {row && (editMode ? row : (
        <Link href={item.href} style={{ display: 'block', minWidth: 0, color: 'inherit', textDecoration: 'none' }}>
          {row}
        </Link>
      ))}
    </div>
  );
}
