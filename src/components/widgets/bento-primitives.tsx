'use client';

/**
 * Shared atoms for the Bento dashboard widgets.
 *
 * All values flow through CSS custom properties (--hpr-*) so the live theme
 * inspector can recolor the whole dashboard without prop drilling. Mirrors the
 * design source at /tmp/design-fetch/helprrdashbaord/project/widgets.jsx.
 */

import * as React from 'react';
import { ArrowLeftRight, ArrowUpDown, Check, LayoutGrid, List, Plus, Save, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

export const HPR = {
  ink: 'var(--hpr-ink)',
  inkSoft: 'var(--hpr-inkSoft)',
  surface: 'var(--hpr-surface)',
  surfaceHi: 'var(--hpr-surfaceHi)',
  hairline: 'var(--hpr-hairline)',
  hairline2: 'var(--hpr-hairline2)',
  fg: 'var(--hpr-fg)',
  fgMute: 'var(--hpr-fgMute)',
  fgSubtle: 'var(--hpr-fgSubtle)',
  amber: 'var(--hpr-amber)',
  green: 'var(--hpr-green)',
  rose: 'var(--hpr-rose)',
  blue: 'var(--hpr-blue)',
  purple: 'var(--hpr-purple)',
  violet: 'var(--hpr-violet)',
  cyan: 'var(--hpr-cyan)',
  pink: 'var(--hpr-pink)',
} as const;

export const FONT_BODY = 'var(--hpr-font-body)';
export const FONT_DISPLAY = 'var(--hpr-font-display)';
export const FONT_MONO = 'var(--hpr-font-mono)';

// ─── Sizing constants for carousels / list widgets ──────────────────────
// Base card size for any carousel that shows poster + title + meta. Wider
// than the original 82×123 so date subtitles like "May 17, 1:00 PM" fit on
// one line without ellipsis.
export const CAROUSEL_CARD_WIDTH = 110;
export const CAROUSEL_CARD_HEIGHT = 165;
export const CAROUSEL_GAP = 10;
// Row height used to estimate how many items fit when a list-style widget
// is rendered vertically. Tuned to the 26–28px icon + 2 lines of text rows
// the dashboard list rows share.
export const LIST_ROW_HEIGHT = 50;
// Approx height eaten by SectionHeader / Eyebrow + its bottom margin.
export const SECTION_HEADER_HEIGHT = 32;
// Below this measured pixel width, small status widgets drop their icon.
export const ICON_HIDE_THRESHOLD = 160;
export const ICON_HIDE_HEIGHT_THRESHOLD = 90;

/** color-mix helper that stays theme-reactive. */
export const mix = (c: string, p: number): string =>
  `color-mix(in oklab, ${c} ${p}%, transparent)`;

export const AMBER_SOFT = mix(HPR.amber, 14);
export const AMBER_RING = mix(HPR.amber, 35);

// ─── Eyebrow ────────────────────────────────────────────────────────────
export function Eyebrow({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        fontSize: 10,
        color: HPR.fgSubtle,
        fontWeight: 500,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Hairline ───────────────────────────────────────────────────────────
export function Hairline({
  vertical = false,
  style,
}: {
  vertical?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: HPR.hairline,
        width: vertical ? 1 : '100%',
        height: vertical ? '100%' : 1,
        ...style,
      }}
    />
  );
}

// ─── SectionHeader ──────────────────────────────────────────────────────
export function SectionHeader({
  title,
  right,
  badge,
  size = 'md',
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  badge?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const fontSize = size === 'lg' ? 18 : size === 'sm' ? 13 : 15;
  return (
    // Layout props live in classes so tiny cells can wrap the header onto two
    // lines (title, then badge/controls) instead of crushing the title away.
    <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2 @max-[159px]/cell:flex-wrap">
      <div className="flex min-w-0 items-center gap-2 overflow-hidden @max-[159px]/cell:flex-wrap">
        {title ? (
          <h3
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontSize,
              color: HPR.fg,
              margin: 0,
              letterSpacing: '-0.015em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </h3>
        ) : null}
        {badge}
      </div>
      {right && (
        <div
          // "View all" links here are one line of 11px text; give them a 44px
          // hit area without growing the header. Raised one layer so the
          // controls' hit areas aren't covered by the widget's masked list.
          // Links sit last in the row, so they grow rightward only and can't
          // cover the pill toggle before them (compact cells shrink "View all"
          // to an arrow beside it).
          className="relative z-[1] [&_a]:relative [&_a]:touch-target [&_a]:after:left-0 [&_a]:after:[transform:translateY(-50%)]"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            color: HPR.fgMute,
            fontSize: 11,
            flexShrink: 0,
          }}
        >
          {right}
        </div>
      )}
    </div>
  );
}

// ─── Poster (gradient placeholder) ──────────────────────────────────────
export type PosterTone =
  | 'blue'
  | 'purple'
  | 'rose'
  | 'green'
  | 'amber'
  | 'pink'
  | 'teal'
  | 'indigo'
  | 'olive'
  | 'crimson';

const tintAgainstSurface = (c: string, p: number) =>
  `color-mix(in oklab, ${c} ${p}%, ${HPR.surface})`;

const POSTER_TONES: Record<PosterTone, [string, string]> = {
  blue: [tintAgainstSurface(HPR.blue, 35), tintAgainstSurface(HPR.blue, 18)],
  purple: [tintAgainstSurface(HPR.purple, 35), tintAgainstSurface(HPR.purple, 18)],
  rose: [tintAgainstSurface(HPR.rose, 35), tintAgainstSurface(HPR.rose, 18)],
  green: [tintAgainstSurface(HPR.green, 35), tintAgainstSurface(HPR.green, 18)],
  amber: [tintAgainstSurface(HPR.amber, 35), tintAgainstSurface(HPR.amber, 18)],
  pink: [tintAgainstSurface(HPR.pink, 35), tintAgainstSurface(HPR.pink, 18)],
  teal: [tintAgainstSurface(HPR.cyan, 35), tintAgainstSurface(HPR.cyan, 18)],
  indigo: [tintAgainstSurface(HPR.violet, 35), tintAgainstSurface(HPR.violet, 18)],
  olive: [tintAgainstSurface(HPR.amber, 25), tintAgainstSurface(HPR.amber, 12)],
  crimson: [tintAgainstSurface(HPR.rose, 45), tintAgainstSurface(HPR.rose, 22)],
};

export function toneFromString(seed: string | undefined | null): PosterTone {
  if (!seed) return 'blue';
  const keys = Object.keys(POSTER_TONES) as PosterTone[];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return keys[hash % keys.length];
}

export function Poster({
  width = 72,
  height = 108,
  label = '',
  tone = 'blue',
  badge,
  progress,
  rating,
  check = false,
  fontSize = 10,
  imageUrl,
  timePill,
}: {
  width?: number;
  height?: number;
  label?: string;
  tone?: PosterTone;
  badge?: { icon: React.ReactNode; color?: string };
  progress?: number | null;
  rating?: string | number | null;
  check?: boolean;
  fontSize?: number;
  imageUrl?: string | null;
  /** Optional pill rendered over the bottom-left of the poster (e.g., "in 1 day"). */
  timePill?: string | null;
}) {
  const [c1, c2] = POSTER_TONES[tone] ?? POSTER_TONES.blue;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 6,
        position: 'relative',
        flexShrink: 0,
        background: imageUrl
          ? `linear-gradient(135deg, ${c1}, ${c2})`
          : `linear-gradient(135deg, ${c1}, ${c2})`,
        backgroundImage: imageUrl
          // Wrap in double quotes and percent-encode embedded quotes so URLs
          // with `)` or whitespace cannot break out of the CSS `url(...)` token.
          ? `url("${imageUrl.replace(/"/g, '%22')}"), linear-gradient(135deg, ${c1}, ${c2})`
          : `linear-gradient(135deg, ${c1}, ${c2}), repeating-linear-gradient(45deg, ${mix(HPR.fg, 4)} 0 2px, transparent 2px 6px)`,
        backgroundSize: imageUrl ? 'cover, auto' : 'auto',
        backgroundPosition: imageUrl ? 'center, 0 0' : '0 0',
        backgroundBlendMode: imageUrl ? 'normal' : 'overlay',
        overflow: 'hidden',
        boxShadow: `inset 0 0 0 1px ${mix(HPR.fg, 4)}`,
      }}
    >
      {!imageUrl && label && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 6,
            textAlign: 'center',
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            fontSize,
            lineHeight: 1.1,
            color: mix(HPR.fg, 78),
            textShadow: `0 1px 2px ${mix(HPR.ink, 40)}`,
            letterSpacing: '-0.01em',
          }}
        >
          {label}
        </div>
      )}
      {badge && (
        <div
          style={{
            position: 'absolute',
            top: 5,
            left: 5,
            width: 18,
            height: 18,
            borderRadius: 4,
            background: mix(HPR.ink, 55),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            color: badge.color ?? HPR.fg,
          }}
        >
          {badge.icon}
        </div>
      )}
      {rating != null && rating !== '' && (
        <div
          style={{
            position: 'absolute',
            top: 5,
            right: 5,
            padding: '2px 5px',
            borderRadius: 4,
            background: mix(HPR.ink, 60),
            color: HPR.amber,
            fontSize: 9,
            fontFamily: FONT_MONO,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
          }}
        >
          ★ {rating}
        </div>
      )}
      {check && (
        <div
          style={{
            position: 'absolute',
            top: 5,
            right: 5,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: HPR.green,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: HPR.ink,
          }}
        >
          <Check size={11} strokeWidth={3} />
        </div>
      )}
      {timePill && (
        <div
          style={{
            position: 'absolute',
            left: 5,
            right: 5,
            bottom: 5,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            padding: '2px 6px',
            borderRadius: 5,
            background: mix(HPR.ink, 30),
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            color: HPR.fg,
            fontSize: 8,
            fontFamily: FONT_MONO,
            fontWeight: 500,
            width: 'fit-content',
            maxWidth: '100%',
            whiteSpace: 'nowrap',
            textWrap:'wrap'
          }}
        >
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', 
            textTransform: /[A-Z]/.test(timePill) ? 'none' : 'capitalize',
           }}>{timePill}</span>
        </div>
      )}
      {progress != null && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 3,
            background: mix(HPR.ink, 40),
          }}
        >
          <div style={{ width: `${progress}%`, height: '100%', background: HPR.cyan }} />
        </div>
      )}
    </div>
  );
}

// ─── Dot ────────────────────────────────────────────────────────────────
export function Dot({
  color = HPR.green,
  size = 6,
  pulse = false,
}: {
  color?: string;
  size?: number;
  pulse?: boolean;
}) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <span
        style={{
          display: 'inline-block',
          width: size,
          height: size,
          borderRadius: '50%',
          background: color,
        }}
      />
      {pulse && (
        <span
          className="hpr-ping"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: color,
            opacity: 0.6,
          }}
        />
      )}
    </span>
  );
}

// ─── Pill ───────────────────────────────────────────────────────────────
export function Pill({
  children,
  color = HPR.amber,
  ghost = false,
  style,
}: {
  children: React.ReactNode;
  color?: string;
  ghost?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 7px',
        borderRadius: 999,
        fontSize: 10,
        fontFamily: FONT_MONO,
        letterSpacing: '0.04em',
        color,
        background: ghost ? 'transparent' : mix(color, 14),
        border: `1px solid ${mix(color, 30)}`,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// ─── Bar ────────────────────────────────────────────────────────────────
export function Bar({
  pct = 40,
  color = HPR.amber,
  height = 3,
}: {
  pct?: number;
  color?: string;
  height?: number;
}) {
  return (
    <div
      style={{
        width: '100%',
        height,
        background: mix(HPR.fg, 6),
        borderRadius: 999,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          height: '100%',
          background: color,
          borderRadius: 999,
        }}
      />
    </div>
  );
}

// ─── StatTile (icon + value + label) ───────────────────────────────────
export function StatTile({
  icon,
  label,
  value,
  tone = HPR.amber,
  narrow = false,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: string;
  narrow?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: narrow ? 8 : 10,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <div
        // Icon is decoration — it goes first when the cell can't fit icon + value.
        // display comes from classes so the container variant's `hidden` wins.
        className="flex items-center justify-center @max-[239px]/cell:hidden"
        style={{
          width: narrow ? 28 : 32,
          height: narrow ? 28 : 32,
          borderRadius: 7,
          background: mix(tone, 14),
          color: tone,
          flexShrink: 0,
          fontSize: 13,
        }}
      >
        {icon}
      </div>
      {/* Below 160px the cell stacks one tile per row, so each tile becomes a
          single "label … value" line to keep all four inside the cell. */}
      <div className="flex min-w-0 flex-col gap-px @max-[159px]/cell:w-full @max-[159px]/cell:flex-row-reverse @max-[159px]/cell:items-baseline @max-[159px]/cell:justify-between @max-[159px]/cell:gap-2">
        <span
          // Font size lives in classes (not inline style) so the container
          // variant can shrink it — the value must stay fully visible.
          className={cn(
            narrow ? 'text-lg' : 'text-[22px]',
            '@max-[239px]/cell:text-[15px]'
          )}
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            color: HPR.fg,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {value}
        </span>
        <Eyebrow
          style={{
            fontSize: 9,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </Eyebrow>
      </div>
    </div>
  );
}

// ─── BentoTopBar (sticky top header for the dashboard) ─────────────────
export interface BentoTopBarProps {
  mobile?: boolean;
  edit?: boolean;
  title: string;
  eyebrow: React.ReactNode;
  onAdd?: () => void;
  onDone?: () => void;
  onEdit?: () => void;
  onSave?: () => void;
  onDiscard?: () => void;
  onSwitch?: () => void;
  onConfigureRefresh?: () => void;
  saving?: boolean;
  dirty?: boolean;
  rightStatus?: React.ReactNode;
}

export function BentoTopBar({
  mobile = false,
  edit = false,
  title,
  eyebrow,
  onAdd,
  onDone,
  onSave,
  onDiscard,
  onSwitch,
  onConfigureRefresh,
  saving = false,
  dirty = false,
  rightStatus,
}: BentoTopBarProps) {
  return (
    <div
      style={{
        position: 'sticky',
        // Pin below the app header (and the iPhone status bar), not under it.
        top: 'var(--header-height, 0px)',
        zIndex: 10,
        // Bleed across the dashboard's own padding so the solid bar spans the
        // page; widgets scrolling underneath no longer show through it.
        marginInline: mobile ? '-0.75rem' : '-1.75rem',
        padding: mobile ? '14px 26px 10px' : '14px 1.75rem 12px',
        background: mix(HPR.ink, 92),
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      {!edit && (
        <>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: HPR.amber,
              color: HPR.ink,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 15,
              flexShrink: 0,
              letterSpacing: '-0.04em',
            }}
          >
            h
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 18,
                color: HPR.fg,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {title}
            </div>
            <Eyebrow>{eyebrow}</Eyebrow>
          </div>
        </>
      )}
      {edit ? (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
          {onSwitch && (
            <button type="button" onClick={onSwitch} className="relative touch-target" style={btnSecondary}>
              Layouts
            </button>
          )}
          {onConfigureRefresh && (
            <button
              type="button"
              className="relative touch-target"
              onClick={onConfigureRefresh}
              aria-label="Configure refresh intervals"
              style={btnIcon}
            >
              <Settings size={14} strokeWidth={2.2} />
            </button>
          )}
          {onAdd && (
            <button type="button" onClick={onAdd} aria-label="Add widget" className="relative touch-target" style={btnIcon}>
              <Plus size={14} strokeWidth={2.2} />
            </button>
          )}
          {onDiscard && dirty && (
            <button type="button" onClick={onDiscard} disabled={saving} className="relative touch-target" style={btnSecondary}>
              Discard
            </button>
          )}
          {onSave && (
            <button
              type="button"
              className="relative touch-target"
              onClick={onSave}
              disabled={!dirty || saving}
              aria-label={saving ? 'Saving' : 'Save'}
              style={{ ...btnIconPrimary, opacity: !dirty || saving ? 0.5 : 1, cursor: !dirty || saving ? 'default' : 'pointer' }}
            >
              <Save size={14} strokeWidth={2.2} />
            </button>
          )}
          {onDone && (
            <button type="button" onClick={onDone} className="relative touch-target" style={btnDone}>
              Done
            </button>
          )}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: HPR.fgMute,
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          {rightStatus}
        </div>
      )}
    </div>
  );
}

const btnSecondary: React.CSSProperties = {
  padding: '7px 12px',
  background: 'transparent',
  color: HPR.fgMute,
  border: `1px solid ${HPR.hairline2}`,
  borderRadius: 8,
  fontFamily: FONT_BODY,
  fontSize: 12,
  cursor: 'pointer',
};

const btnIcon: React.CSSProperties = {
  width: 30,
  height: 30,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  color: HPR.fgMute,
  border: `1px solid ${HPR.hairline2}`,
  borderRadius: 8,
  cursor: 'pointer',
};

const btnIconPrimary: React.CSSProperties = {
  width: 30,
  height: 30,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: HPR.amber,
  color: HPR.ink,
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};

const btnDone: React.CSSProperties = {
  padding: '7px 14px',
  background: HPR.fg,
  color: HPR.ink,
  border: 'none',
  borderRadius: 8,
  fontFamily: FONT_BODY,
  fontWeight: 600,
  fontSize: 12,
  cursor: 'pointer',
};

// ─── FloatingEdit (bottom-right pencil / done toggle) ──────────────────
export function FloatingEdit({
  edit = false,
  mobile = false,
  onClick,
}: {
  edit?: boolean;
  mobile?: boolean;
  onClick?: () => void;
}) {
  // Slides away while scrolling down so it doesn't sit on widget headers, and
  // comes back on any upward scroll or near the top of the page.
  const [hidden, setHidden] = React.useState(false);
  React.useEffect(() => {
    let anchor = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 80) {
        setHidden(false);
        anchor = y;
        return;
      }
      if (y - anchor > 24) {
        setHidden(true);
        anchor = y;
      } else if (anchor - y > 24) {
        setHidden(false);
        anchor = y;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={edit ? 'Done editing dashboard' : 'Edit dashboard'}
      tabIndex={hidden ? -1 : undefined}
      style={{
        transform: hidden ? 'translateY(calc(100% + 24px))' : undefined,
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? 'none' : undefined,
        transition: 'transform 0.2s ease, opacity 0.2s ease',
        position: 'fixed',
        // Clear the tab bar, home indicator and now-playing bar like the other
        // floating bars; a fixed offset sat on the iPhone tab bar. The mini
        // video player shares this corner, so step over it too.
        bottom: `calc(var(--footer-height) + var(--player-bar-height, 0px) + var(--mini-player-clearance, 0px) + ${mobile ? 16 : 30}px)`,
        right: edit ? (mobile ? "40%" : "40%") : mobile ? 50 : 36,
        width: 48 ,
        height: 48 ,
        minHeight: mobile ? undefined : 42,
        padding: mobile ? 0 : '9px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius:  9999,
        background: edit ? HPR.amber : HPR.surface,
        border: `1px solid ${edit ? HPR.amber : HPR.hairline2}`,
        boxShadow: edit
          ? `0 0 0 6px ${mix(HPR.amber, 18)}, 0 8px 24px ${mix(HPR.ink, 60)}`
          : `0 8px 24px ${mix(HPR.ink, 50)}`,
        color: edit ? HPR.ink : HPR.amber,
        fontSize: mobile ? 18 : 12,
        zIndex: 40,
        fontFamily: FONT_BODY,
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {mobile ? (
        edit ? '✓' : '✎'
      ) : (
        <>
          <span style={{ color: edit ? HPR.ink : HPR.amber, fontSize: 14 }}>
            {edit ? '✓' : '✎'}
          </span>
          {/* {edit ? 'Done' : 'Customize'} */}
        </>
      )}
    </button>
  );
}

// ─── ViewModeToggle (carousel ⇄ list) ─────────────────────────────────
export function ViewModeToggle({
  value,
  onChange,
}: {
  value: 'carousel' | 'list';
  onChange: (next: 'carousel' | 'list') => void;
}) {
  return (
    <div
      role="group"
      aria-label="View mode"
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        borderRadius: 6,
        border: `1px solid ${HPR.hairline2}`,
        height: 22,
      }}
    >
      <ViewModeButton
        corner="start"
        active={value === 'carousel'}
        label="Carousel view"
        onClick={() => onChange('carousel')}
      >
        <LayoutGrid size={11} strokeWidth={2} />
      </ViewModeButton>
      <div style={{ width: 1, background: HPR.hairline2 }} />
      <ViewModeButton
        corner="end"
        active={value === 'list'}
        label="List view"
        onClick={() => onChange('list')}
      >
        <List size={11} strokeWidth={2} />
      </ViewModeButton>
    </div>
  );
}

function ViewModeButton({
  corner,
  active,
  label,
  onClick,
  children,
}: {
  /** Which end of the pill this is, so its active fill keeps the round corners. */
  corner: 'start' | 'end';
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      // A taller hit area than the 22px pill; the width stays, since the two
      // halves touch.
      className="relative touch-target-y"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: '100%',
        padding: 0,
        border: 'none',
        borderRadius: corner === 'start' ? '5px 0 0 5px' : '0 5px 5px 0',
        background: active ? mix(HPR.amber, 18) : 'transparent',
        color: active ? HPR.amber : HPR.fgMute,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

// ─── VariantToggle (default ⇄ vertical) ───────────────────────────────
// Used by indicator widgets (overview / prowlarr / wanted / torrents /
// service-health / storage) to flip between the wide icon-left layout and a
// compact stacked layout. The value maps directly to WidgetInstance.layoutOverride.
export function VariantToggle({
  value,
  onChange,
}: {
  value: 'default' | 'vertical';
  onChange: (next: 'default' | 'vertical') => void;
}) {
  return (
    <div
      role="group"
      aria-label="Layout mode"
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        borderRadius: 6,
        border: `1px solid ${HPR.hairline2}`,
        height: 22,
      }}
    >
      <VariantButton
        corner="start"
        active={value === 'default'}
        label="Horizontal layout"
        onClick={() => onChange('default')}
      >
        <ArrowLeftRight size={11} strokeWidth={2} />
      </VariantButton>
      <div style={{ width: 1, background: HPR.hairline2 }} />
      <VariantButton
        corner="end"
        active={value === 'vertical'}
        label="Vertical layout"
        onClick={() => onChange('vertical')}
      >
        <ArrowUpDown size={11} strokeWidth={2} />
      </VariantButton>
    </div>
  );
}

function VariantButton({
  corner,
  active,
  label,
  onClick,
  children,
}: {
  /** Which end of the pill this is, so its active fill keeps the round corners. */
  corner: 'start' | 'end';
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      // A taller hit area than the 22px pill; the width stays, since the two
      // halves touch.
      className="relative touch-target-y"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: '100%',
        padding: 0,
        border: 'none',
        borderRadius: corner === 'start' ? '5px 0 0 5px' : '0 5px 5px 0',
        background: active ? mix(HPR.amber, 18) : 'transparent',
        color: active ? HPR.amber : HPR.fgMute,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

// ─── EmptyState ────────────────────────────────────────────────────────
export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="bento-empty"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4px 16px',
        gap: 6,
        color: HPR.fgSubtle,
        fontSize: 11,
        fontFamily: FONT_BODY,
        textAlign: 'center',
        // Fills whatever the header leaves, so the message sits mid-cell
        // (flex parents grow it; block scrollers resolve the 100%). Its own
        // height drives the globals.css query that drops the icon in short cells.
        flex: 1,
        height: '100%',
        minHeight: 24,
        container: 'bento-empty / size',
      }}
    >
      {children}
    </div>
  );
}
