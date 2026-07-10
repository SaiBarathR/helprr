'use client';

import * as React from 'react';
import { AMBER_RING, FONT_MONO, HPR, mix } from './bento-primitives';

export interface BentoCellProps {
  /** Effective column span on the current grid. */
  colSpan: number;
  rowSpan?: number;
  /** Inner padding override. Defaults to 8 (or 11 when narrow=true or mobile=true). */
  pad?: number;
  /** Tint hue (mixed with surface). */
  hue?: string | null;
  /** Raised surface (slightly lighter background). */
  raised?: boolean;
  /** Edit mode — show amber outline + edit chrome. */
  edit?: boolean;
  /** This cell is the dragging widget. */
  dragging?: boolean;
  /** Origin cell ghost (invisible card, dashed outline). */
  ghost?: boolean;
  /** Mobile rendering — simpler size pill, smaller paddings. */
  mobile?: boolean;
  /** Narrow half-row cell — shrinks padding. */
  narrow?: boolean;
  /** Element style overrides (e.g. inline gridColumn span). */
  style?: React.CSSProperties;
  /** Render the edit chrome (drag handle, remove, size pill, resize handle). */
  chrome?: React.ReactNode;
  children?: React.ReactNode;
}

export function BentoCell({
  colSpan,
  rowSpan = 1,
  pad,
  hue = null,
  raised = false,
  edit = false,
  dragging = false,
  ghost = false,
  mobile = false,
  narrow = false,
  style,
  chrome,
  children,
}: BentoCellProps) {
  const effectivePad = pad ?? (narrow || mobile ? 11 : 8);
  const cardBg = raised
    ? HPR.surfaceHi
    : hue
      ? `linear-gradient(135deg, ${hue}, ${HPR.surface} 65%)`
      : HPR.surface;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        position: 'relative',
        transition: 'transform 0.3s cubic-bezier(0.2,0.7,0.3,1), opacity 0.22s ease',
        transform: dragging ? 'scale(1.025) rotate(-1.2deg)' : 'none',
        opacity: ghost ? 0.001 : 1,
        ...style,
      }}
    >
      {ghost ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            border: `1.5px dashed ${AMBER_RING}`,
            borderRadius: 10,
            background: 'transparent',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: HPR.amber,
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: '0.12em',
            }}
          >
            ORIGIN · {colSpan}×{rowSpan}
          </div>
        </div>
      ) : (
        <div
          // Liquid Glass hook: html[data-glass] [data-bento-cell] in globals.css
          // overrides this inline background with the translucent glass fill.
          // @container/cell lets widgets restructure via container-query variants
          // (e.g. @max-[219px]/cell:hidden) based on their own cell width.
          data-bento-cell=""
          className="@container/cell"
          style={{
            position: 'relative',
            background: cardBg,
            border: `1px solid ${edit ? AMBER_RING : HPR.hairline}`,
            borderRadius: 10,
            padding: effectivePad,
            height: '100%',
            // Footprint comes from S/M/L/XL, not from data. Without this the cell
            // would auto-size to (often empty) content and visibly collapse during
            // drags or while polling is paused in edit mode.
            minHeight: `${rowSpan >= 2 ? 170 : 82}px`,
            minWidth: 0,
            overflow: 'hidden',
            boxShadow: dragging
              ? `0 32px 64px ${mix(HPR.ink, 70)}, 0 0 0 1.5px ${HPR.amber}, 0 0 60px ${mix(HPR.amber, 25)}`
              : raised
                ? `0 8px 22px ${mix(HPR.ink, 25)}`
                : 'none',
            transition: 'box-shadow 0.2s, transform 0.25s',
          }}
        >
          {edit && !dragging && chrome}
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Edit chrome (drag handle bar + remove button) ──
// Both desktop and mobile grids use react-grid-layout, which listens for
// pointer events on the `.bento-drag-handle` element and provides a SE corner
// resize handle. Touch sizes are sized for fingers on mobile but stay
// unobtrusive on desktop.
export interface BentoEditChromeProps {
  onRemove?: () => void;
}

export function BentoEditChrome({ onRemove }: BentoEditChromeProps) {
  return (
    <>
      {/* drag handle */}
      <button
        type="button"
        aria-label="Drag widget"
        className="bento-drag-handle"
        style={{
          position: 'absolute',
          top: 6,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 40,
          height: 6,
          borderRadius: 3,
          background: AMBER_RING,
          border: 'none',
          padding: 0,
          cursor: 'grab',
          zIndex: 3,
          touchAction: 'none',
        }}
      />
      {/* remove */}
      <button
        type="button"
        aria-label="Remove widget"
        onClick={(e) => {
          e.stopPropagation();
          onRemove?.();
        }}
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: HPR.rose,
          color: 'var(--hpr-fg)',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          lineHeight: 1,
          fontWeight: 600,
          cursor: 'pointer',
          zIndex: 3,
          padding: 0,
        }}
      >
        −
      </button>
    </>
  );
}
