'use client';

/**
 * Shared atoms for the Bento dashboard widgets.
 *
 * All values flow through CSS custom properties (--hpr-*) so the live theme
 * inspector can recolor the whole dashboard without prop drilling. Mirrors the
 * design source at /tmp/design-fetch/helprrdashbaord/project/widgets.jsx.
 */

import * as React from 'react';
import { Check, Clock, LayoutGrid, List, Plus, Save } from 'lucide-react';

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
export const ICON_HIDE_THRESHOLD = 140;

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
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
        gap: 8,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
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
        {badge}
      </div>
      {right && (
        <div
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

const POSTER_TONES: Record<PosterTone, [string, string]> = {
  blue: ['#2c3a55', '#1a2237'],
  purple: ['#3a2c55', '#241a37'],
  rose: ['#552c3a', '#37212a'],
  green: ['#2c5544', '#1a3729'],
  amber: ['#553e2c', '#372a1a'],
  pink: ['#5a2c44', '#37192a'],
  teal: ['#2c5552', '#1a3735'],
  indigo: ['#352c55', '#1f1a37'],
  olive: ['#4d4d2c', '#33321a'],
  crimson: ['#552c2c', '#37191a'],
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
          : `linear-gradient(135deg, ${c1}, ${c2}), repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 2px, transparent 2px 6px)`,
        backgroundSize: imageUrl ? 'cover, auto' : 'auto',
        backgroundPosition: imageUrl ? 'center, 0 0' : '0 0',
        backgroundBlendMode: imageUrl ? 'normal' : 'overlay',
        overflow: 'hidden',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
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
            color: 'rgba(255,255,255,0.78)',
            textShadow: '0 1px 2px rgba(0,0,0,0.4)',
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
            background: 'rgba(0,0,0,0.55)',
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
            background: 'rgba(0,0,0,0.6)',
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
            color: '#0a3a22',
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
            background: 'rgba(0, 0, 0, 0.3)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            color: 'rgba(255, 255, 255, 1)',
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
            background: 'rgba(0,0,0,0.4)',
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
        background: 'rgba(255,255,255,0.06)',
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
      }}
    >
      <div
        style={{
          width: narrow ? 28 : 32,
          height: narrow ? 28 : 32,
          borderRadius: 7,
          background: mix(tone, 14),
          color: tone,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontSize: 13,
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            fontSize: narrow ? 18 : 22,
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
        <Eyebrow style={{ fontSize: 9 }}>{label}</Eyebrow>
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
  saving = false,
  dirty = false,
  rightStatus,
}: BentoTopBarProps) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        padding: mobile ? '14px 14px 10px' : '14px 0 12px',
        // background: `lineaFor thr-gradient(180deg, ${HPR.inkSoft} 70%, transparent)`,
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
            <button type="button" onClick={onSwitch} style={btnSecondary}>
              Layouts
            </button>
          )}
          {onAdd && (
            <button type="button" onClick={onAdd} aria-label="Add widget" style={btnIcon}>
              <Plus size={14} strokeWidth={2.2} />
            </button>
          )}
          {onDiscard && dirty && (
            <button type="button" onClick={onDiscard} disabled={saving} style={btnSecondary}>
              Discard
            </button>
          )}
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || saving}
              aria-label={saving ? 'Saving' : 'Save'}
              style={{ ...btnIconPrimary, opacity: !dirty || saving ? 0.5 : 1, cursor: !dirty || saving ? 'default' : 'pointer' }}
            >
              <Save size={14} strokeWidth={2.2} />
            </button>
          )}
          {onDone && (
            <button type="button" onClick={onDone} style={btnDone}>
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

const btnPrimary: React.CSSProperties = {
  padding: '7px 12px',
  background: HPR.amber,
  color: HPR.ink,
  border: 'none',
  borderRadius: 8,
  fontFamily: FONT_BODY,
  fontWeight: 600,
  fontSize: 12,
  cursor: 'pointer',
  letterSpacing: '-0.01em',
};

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
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={edit ? 'Done editing dashboard' : 'Edit dashboard'}
      style={{
        position: 'fixed',
        bottom: mobile ? 80 : 30,
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
          ? `0 0 0 6px ${mix(HPR.amber, 18)}, 0 8px 24px rgba(0,0,0,0.6)`
          : '0 8px 24px rgba(0,0,0,0.5)',
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
        overflow: 'hidden',
        height: 22,
      }}
    >
      <ViewModeButton
        active={value === 'carousel'}
        label="Carousel view"
        onClick={() => onChange('carousel')}
      >
        <LayoutGrid size={11} strokeWidth={2} />
      </ViewModeButton>
      <div style={{ width: 1, background: HPR.hairline2 }} />
      <ViewModeButton
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
  active,
  label,
  onClick,
  children,
}: {
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
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        gap: 6,
        color: HPR.fgSubtle,
        fontSize: 11,
        fontFamily: FONT_BODY,
        textAlign: 'center',
        minHeight: 80,
      }}
    >
      {children}
    </div>
  );
}
