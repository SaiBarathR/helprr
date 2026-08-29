'use client';

import { ChevronDown, Play, Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * What the hover popover says about a title.
 *
 * Measured from netflix.com at 1440px: a 38px button row, then one fact line in
 * #bcbcbc, then dot-separated tags in white. A card in Continue Watching swaps
 * the fact line for the episode label and the tags for a red resume bar with
 * "27 of 46m" beside it.
 */
export interface TilePanelContent {
  /** `S1:E9 "Trial by Fire"` — episode cards lead with this instead of facts. */
  episodeLabel?: string | null;
  /**
   * The fact line: certificate, then a season count for a series or a runtime
   * for a film. The site also carries HD/Dolby badges here; Helprr's card
   * payload has no media streams, so those are absent.
   */
  facts?: Array<string | null | undefined>;
  /** Mood/genre tags, dot-separated. */
  tags?: string[];
  /** 0–100. Renders the resume bar in place of the tags. */
  progressPct?: number;
  /** `27 of 46m`, beside the resume bar. */
  resumeLabel?: string | null;
}

function CircleButton({
  label,
  filled = false,
  active = false,
  onClick,
  children,
}: {
  label: string;
  filled?: boolean;
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={onClick && !filled ? active : undefined}
      onClick={(event) => {
        // The tile's stretched link sits underneath; a control on top of it
        // must not also navigate.
        event.preventDefault();
        event.stopPropagation();
        onClick?.();
      }}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors xl:size-[38px]',
        filled
          ? 'bg-white text-black hover:bg-white/90'
          : 'border-2 border-white/50 bg-[rgba(42,42,42,0.6)] text-white hover:border-white',
      )}
    >
      {children}
    </button>
  );
}

/**
 * The popover's lower half. Rendered by both cinematic tiles so a
 * recommendation row and a Continue Watching row read identically.
 */
export function TilePanel({
  title,
  content,
  onPlay,
  onMoreInfo,
  onToggleMyList,
  inMyList = false,
}: {
  title: string;
  content: TilePanelContent;
  onPlay?: () => void;
  onMoreInfo?: () => void;
  onToggleMyList?: () => void;
  inMyList?: boolean;
}) {
  const facts = (content.facts ?? []).filter(Boolean) as string[];
  const showResume = typeof content.progressPct === 'number'
    && content.progressPct > 0
    && content.progressPct < 100;

  return (
    <div className="hpr-cine-panel">
      <div className="flex h-full flex-col justify-center gap-2 bg-[#181818] px-3 xl:px-4">
        {/* Rails with nothing behind them in the library — an unreleased film,
            a title that is only a recommendation — get no button row at all
            rather than an empty 38px strip. */}
        {(onPlay || onToggleMyList || onMoreInfo) && (
        <div className="flex items-center gap-2">
          {onPlay && (
            <CircleButton label={`Play ${title}`} filled onClick={onPlay}>
              <Play className="size-4 fill-current" />
            </CircleButton>
          )}
          {onToggleMyList && (
            <CircleButton
              label={inMyList ? `Remove ${title} from My List` : `Add ${title} to My List`}
              active={inMyList}
              onClick={onToggleMyList}
            >
              {inMyList ? <Check className="size-4" strokeWidth={3} /> : <Plus className="size-4" />}
            </CircleButton>
          )}
          {onMoreInfo && (
            <span className="ml-auto">
              <CircleButton label={`More info about ${title}`} onClick={onMoreInfo}>
                <ChevronDown className="size-4" />
              </CircleButton>
            </span>
          )}
        </div>
        )}

        {content.episodeLabel ? (
          <p className="truncate text-[12px] font-semibold text-white xl:text-[15px]">
            {content.episodeLabel}
          </p>
        ) : facts.length > 0 ? (
          <p className="flex min-w-0 items-center gap-2 text-[11px] text-[#bcbcbc] xl:text-[14px]">
            {facts.map((fact, index) => (
              index === 0 && /^[A-Z0-9+\-/ ]{1,8}$/i.test(fact) ? (
                // The certificate is a bordered box on the site, not plain text.
                <span key={fact} className="shrink-0 border border-white/40 px-1 text-[10px] xl:text-[12px]">
                  {fact}
                </span>
              ) : (
                <span key={fact} className="truncate">{fact}</span>
              )
            ))}
          </p>
        ) : null}

        {showResume ? (
          <span className="flex items-center gap-2">
            <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/30">
              <span className="block h-full bg-[#e50914]" style={{ width: `${content.progressPct}%` }} />
            </span>
            {content.resumeLabel && (
              <span className="shrink-0 text-[10px] text-white/85 xl:text-[13px]">{content.resumeLabel}</span>
            )}
          </span>
        ) : (content.tags ?? []).length > 0 ? (
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 overflow-hidden text-[11px] text-white xl:text-[14px]">
            {content.tags!.map((tag, index) => (
              <span key={tag} className="flex shrink-0 items-center gap-1.5">
                {index > 0 && <span aria-hidden className="text-white/45">&bull;</span>}
                {tag}
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </div>
  );
}
