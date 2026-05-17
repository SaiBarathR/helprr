'use client';

import * as React from 'react';
import { useUIStore } from '@/lib/store';
import {
  ACCENT_COLORS,
  FONTS,
  GRADIENTS,
  PALETTES,
  type DashboardAccent,
  type DashboardFont,
  type DashboardGradient,
  type DashboardPalette,
} from '@/lib/dashboard-theme';
import { AMBER_RING, Eyebrow, FONT_MONO, HPR, mix } from './bento-primitives';

interface ThemeInspectorProps {
  mobile?: boolean;
}

const ACCENT_IDS: DashboardAccent[] = ['amber', 'crimson', 'cyan', 'violet', 'forest'];
const PALETTE_IDS: DashboardPalette[] = ['warm', 'slate', 'pure', 'cream'];
const GRADIENT_IDS: DashboardGradient[] = ['glow', 'frame', 'none'];
const FONT_IDS: DashboardFont[] = ['system', 'helvetica', 'charter', 'jetbrains'];

export function ThemeInspector({ mobile = false }: ThemeInspectorProps) {
  const accent = useUIStore((s) => s.dashboardAccent);
  const palette = useUIStore((s) => s.dashboardPalette);
  const gradient = useUIStore((s) => s.dashboardGradient);
  const font = useUIStore((s) => s.dashboardFont);

  const setAccent = useUIStore((s) => s.setDashboardAccent);
  const setPalette = useUIStore((s) => s.setDashboardPalette);
  const setGradient = useUIStore((s) => s.setDashboardGradient);
  const setFont = useUIStore((s) => s.setDashboardFont);

  return (
    <div
      style={{
        gridColumn: '1 / -1',
        padding: mobile ? 12 : 16,
        background: `linear-gradient(135deg, ${mix(HPR.amber, 5)}, ${HPR.surface} 70%)`,
        border: `1px solid ${AMBER_RING}`,
        borderRadius: 10,
        display: 'grid',
        gridTemplateColumns: mobile ? '1fr' : 'repeat(4, 1fr)',
        gap: mobile ? 12 : 16,
        position: 'relative',
        marginBottom: 4,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -9,
          left: 14,
          padding: '2px 8px',
          background: HPR.amber,
          color: HPR.ink,
          borderRadius: 5,
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: '0.1em',
          fontWeight: 700,
        }}
      >
        THEME · LIVE
      </div>

      <InspectorBlock label="Accent" sub="status amber stays reserved">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ACCENT_IDS.map((id) => {
            const meta = ACCENT_COLORS[id];
            const selected = id === accent;
            return (
              <button
                key={id}
                type="button"
                aria-label={meta.label}
                onClick={() => setAccent(id)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 7,
                  background: meta.color,
                  position: 'relative',
                  border: 'none',
                  boxShadow: selected
                    ? `0 0 0 2px ${HPR.fg}, 0 0 0 4px ${HPR.surface}`
                    : 'none',
                  cursor: 'pointer',
                }}
              >
                {selected && (
                  <span
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'rgba(0,0,0,0.6)',
                      fontSize: 14,
                      fontWeight: 700,
                    }}
                  >
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </InspectorBlock>

      <InspectorBlock label="Palette" sub="background + surface tones">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {PALETTE_IDS.map((id) => {
            const meta = PALETTES[id];
            const selected = id === palette;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPalette(id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 6px',
                  borderRadius: 5,
                  border: selected ? `1px solid ${HPR.amber}` : '1px solid transparent',
                  background: selected ? mix(HPR.amber, 8) : 'transparent',
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                <span style={{ display: 'flex' }}>
                  {meta.swatch.map((c, j) => (
                    <span
                      key={j}
                      style={{
                        width: 14,
                        height: 14,
                        background: c,
                        borderRadius:
                          j === 0
                            ? '3px 0 0 3px'
                            : j === meta.swatch.length - 1
                              ? '0 3px 3px 0'
                              : 0,
                        border: `1px solid ${HPR.hairline2}`,
                        marginRight: j === meta.swatch.length - 1 ? 0 : -1,
                      }}
                    />
                  ))}
                </span>
                <span style={{ fontSize: 11, color: selected ? HPR.fg : HPR.fgMute, flex: 1 }}>
                  {meta.label}
                </span>
                {selected && (
                  <span style={{ color: HPR.amber, fontSize: 10 }}>●</span>
                )}
              </button>
            );
          })}
        </div>
      </InspectorBlock>

      <InspectorBlock label="Gradient" sub="page atmosphere">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {GRADIENT_IDS.map((id) => {
            const meta = GRADIENTS[id];
            const selected = id === gradient;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setGradient(id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 6px',
                  borderRadius: 5,
                  border: selected ? `1px solid ${HPR.amber}` : '1px solid transparent',
                  background: selected ? mix(HPR.amber, 8) : 'transparent',
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 18,
                    borderRadius: 4,
                    border: `1px solid ${HPR.hairline2}`,
                    background: gradientPreviewBg(id),
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 11, color: selected ? HPR.fg : HPR.fgMute }}>
                  {meta.label}
                </span>
              </button>
            );
          })}
        </div>
      </InspectorBlock>

      <InspectorBlock label="Font" sub="system stack default">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {FONT_IDS.map((id) => {
            const meta = FONTS[id];
            const selected = id === font;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setFont(id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '5px 8px',
                  borderRadius: 5,
                  border: selected ? `1px solid ${HPR.amber}` : `1px solid ${HPR.hairline}`,
                  background: selected ? mix(HPR.amber, 8) : HPR.ink,
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      color: selected ? HPR.fg : HPR.fgMute,
                      fontWeight: selected ? 600 : 400,
                    }}
                  >
                    {meta.label}
                  </div>
                  <div style={{ fontSize: 9, color: HPR.fgSubtle, fontFamily: FONT_MONO }}>
                    {meta.sub}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 14,
                    color: selected ? HPR.fg : HPR.fgSubtle,
                    fontFamily: meta.display,
                    fontWeight: 600,
                  }}
                >
                  Aa
                </span>
              </button>
            );
          })}
        </div>
      </InspectorBlock>

    </div>
  );
}

function InspectorBlock({
  label,
  sub,
  children,
}: {
  label: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
        <Eyebrow style={{ color: HPR.fg, letterSpacing: '0.12em' }}>{label}</Eyebrow>
        {sub && <span style={{ fontSize: 9, color: HPR.fgSubtle }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function gradientPreviewBg(id: DashboardGradient): string {
  if (id === 'glow') {
    return `radial-gradient(ellipse at top, ${mix(HPR.amber, 30)}, ${HPR.ink} 70%)`;
  }
  if (id === 'frame') {
    return `linear-gradient(135deg, ${mix(HPR.amber, 20)}, ${HPR.ink} 30%, ${HPR.ink} 70%, ${mix(HPR.amber, 20)})`;
  }
  return HPR.ink;
}
