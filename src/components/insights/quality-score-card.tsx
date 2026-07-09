'use client';

import * as React from 'react';
import Link from 'next/link';
import { HPR, mix } from '@/components/widgets/bento-primitives';
import { formatBytes } from '@/lib/format';
import { Panel, PanelLoading, PanelEmpty, useInsightsResource } from './insights-shared';
import { kindQuery, type MediaAnalysisKindFilter } from './technical-breakdown-card';
import type { MediaAnalysisResponse, MediaAnalysisUpgradeCandidate } from '@/types/insights';

// Per-file technical quality score (see computeQualityScore in lib/media-analysis)
// rolled up: average ring, score histogram, and the weakest files worth upgrading.

export function scoreColor(score: number): string {
  if (score >= 70) return HPR.green;
  if (score >= 40) return HPR.amber;
  return HPR.rose;
}

export function ScoreRing({ score, files }: { score: number; files: number }) {
  const color = scoreColor(score);
  return (
    <div
      className="relative shrink-0"
      style={{
        width: 72,
        height: 72,
        borderRadius: '50%',
        background: `conic-gradient(${color} ${score}%, ${mix(HPR.fgMute, 18)} 0)`,
      }}
    >
      <div
        className="absolute inset-[8px] rounded-full flex flex-col items-center justify-center"
        style={{ background: HPR.surface }}
      >
        <span style={{ fontFamily: 'var(--hpr-font-display)', fontWeight: 700, fontSize: 18, color: HPR.fg, lineHeight: 1 }}>
          {score}
        </span>
        <span style={{ fontSize: 8, color: HPR.fgSubtle, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>
          avg · {files.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const color = scoreColor(score);
  return (
    <span
      className="inline-flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 tabular-nums text-xs font-semibold shrink-0"
      style={{ background: mix(color, 14), color }}
    >
      {score}
    </span>
  );
}

export function CandidateRow({ c }: { c: MediaAnalysisUpgradeCandidate }) {
  const body = (
    <div className="flex items-center gap-2.5 py-1.5">
      <ScoreBadge score={c.score} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 text-xs">
          <span className="truncate font-medium" style={{ color: HPR.fg }}>{c.title}</span>
          {c.subtitle && (
            <span className="truncate shrink-[2] text-[10px]" style={{ color: HPR.fgSubtle }}>{c.subtitle}</span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {c.reasons.map((reason) => (
            <span
              key={reason}
              className="rounded px-1 py-px text-[9px]"
              style={{ background: mix(HPR.fgMute, 12), color: HPR.fgMute }}
            >
              {reason}
            </span>
          ))}
        </div>
      </div>
      <span className="tabular-nums text-[10px] shrink-0" style={{ color: HPR.fgMute }}>
        {formatBytes(c.size)}
      </span>
    </div>
  );
  return c.href ? (
    <Link href={c.href} className="block hover:opacity-80 transition-opacity">{body}</Link>
  ) : (
    body
  );
}

export function QualityScoreCard({ kind }: { kind: MediaAnalysisKindFilter }) {
  const { data, loading } = useInsightsResource<MediaAnalysisResponse>(
    `/api/insights/media-analysis${kindQuery(kind)}`
  );

  const quality = data?.quality;
  const maxBucket = Math.max(1, ...(quality?.histogram.map((h) => h.count) ?? []));

  return (
    <Panel title="Quality scores">
      {loading && !data ? (
        <PanelLoading height={260} />
      ) : !quality || quality.avgScore === null ? (
        <PanelEmpty message="Not enough technical metadata to score files." height={260} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <ScoreRing score={quality.avgScore} files={data!.totals.scoredFiles} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {quality.histogram.map((h) => (
                <div key={h.bucket} className="flex items-center gap-2" title={`${h.count.toLocaleString()} files`}>
                  <span className="w-12 shrink-0 text-right tabular-nums text-[10px]" style={{ color: HPR.fgMute }}>
                    {h.bucket}
                  </span>
                  <div className="h-1 flex-1 rounded-full" style={{ background: mix(HPR.fgMute, 15) }}>
                    <div
                      className="h-1 rounded-full"
                      style={{ width: `${Math.max((h.count / maxBucket) * 100, h.count > 0 ? 2 : 0)}%`, background: HPR.violet }}
                    />
                  </div>
                  <span className="w-10 shrink-0 tabular-nums text-[10px]" style={{ color: HPR.fgMute }}>
                    {h.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {quality.upgradeCandidates.length > 0 && (
            <>
              <div className="h-px w-full" style={{ background: 'var(--hpr-hairline)' }} />
              <div>
                <span className="text-[10px] uppercase tracking-wide" style={{ color: HPR.fgMute }}>
                  Upgrade candidates
                </span>
                <div className="mt-1 divide-y" style={{ borderColor: 'var(--hpr-hairline)' }}>
                  {quality.upgradeCandidates.map((c) => (
                    <CandidateRow key={c.id} c={c} />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
