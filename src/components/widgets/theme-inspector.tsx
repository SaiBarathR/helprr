'use client';

import * as React from 'react';
import { useUIStore } from '@/lib/store';
import {
  ACCENT_COLORS,
  FONTS,
  GRADIENTS,
  PALETTES,
  resolveForegroundTones,
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
  const fgOverride = useUIStore((s) => s.dashboardFg);
  const fgMuteOverride = useUIStore((s) => s.dashboardFgMute);
  const fgSubtleOverride = useUIStore((s) => s.dashboardFgSubtle);

  const setAccent = useUIStore((s) => s.setDashboardAccent);
  const setPalette = useUIStore((s) => s.setDashboardPalette);
  const setGradient = useUIStore((s) => s.setDashboardGradient);
  const setFont = useUIStore((s) => s.setDashboardFont);
  const setFg = useUIStore((s) => s.setDashboardFg);
  const setFgMute = useUIStore((s) => s.setDashboardFgMute);
  const setFgSubtle = useUIStore((s) => s.setDashboardFgSubtle);

  const paletteDefaults = resolveForegroundTones({ accent, palette, gradient, font });

  return (
    <div
      style={{
        gridColumn: '1 / -1',
        padding: mobile ? 12 : 16,
        background: `linear-gradient(135deg, ${mix(HPR.amber, 5)}, ${HPR.surface} 70%)`,
        border: `1px solid ${AMBER_RING}`,
        borderRadius: 10,
        display: 'grid',
        gridTemplateColumns: mobile ? '1fr' : 'repeat(5, 1fr)',
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

      <InspectorBlock label="Accent" sub="custom or preset color">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
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
                        color: 'color-mix(in oklab, var(--hpr-ink) 60%, transparent)',
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

            {/* Custom Accent Color Picker */}
            {(() => {
              const isCustomAccent = !ACCENT_IDS.includes(accent);
              const currentAccentHex = isCustomAccent ? accent : (ACCENT_COLORS[accent]?.color || '#f5b948');
              return (
                <div
                  style={{
                    position: 'relative',
                    width: 30,
                    height: 30,
                    borderRadius: 7,
                    background: 'linear-gradient(45deg, #e36a7a, #f5b948, #5ac893, #6aa9ee, #b48bf0)',
                    boxShadow: isCustomAccent
                      ? `0 0 0 2px ${HPR.fg}, 0 0 0 4px ${HPR.surface}`
                      : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 5,
                      background: currentAccentHex,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isCustomAccent ? 'var(--hpr-ink)' : 'color-mix(in oklab, var(--hpr-fg) 85%, transparent)',
                      fontWeight: 700,
                      fontSize: 10,
                    }}
                  >
                    {isCustomAccent ? '✓' : '+'}
                  </div>
                  <input
                    type="color"
                    value={currentAccentHex}
                    onChange={(e) => setAccent(e.target.value)}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      opacity: 0,
                      cursor: 'pointer',
                    }}
                  />
                </div>
              );
            })()}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span style={{ fontSize: 10, fontFamily: FONT_MONO, color: HPR.fgSubtle }}>HEX:</span>
            <input
              type="text"
              value={!ACCENT_IDS.includes(accent) ? accent : (ACCENT_COLORS[accent]?.color || '#f5b948')}
              onChange={(e) => {
                let val = e.target.value;
                if (!val.startsWith('#')) val = '#' + val;
                if (val.length <= 7) {
                  setAccent(val);
                }
              }}
              placeholder="#FFFFFF"
              style={{
                width: 75,
                fontSize: 11,
                fontFamily: FONT_MONO,
                background: HPR.ink,
                color: HPR.fg,
                border: `1px solid ${HPR.hairline2}`,
                borderRadius: 4,
                padding: '2px 6px',
                outline: 'none',
              }}
            />
          </div>
        </div>
      </InspectorBlock>

      <InspectorBlock label="Palette" sub="atmosphere base tone">
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

          {/* Custom Palette Option */}
          {(() => {
            const isCustomPalette = !PALETTE_IDS.includes(palette);
            const currentPaletteHex = isCustomPalette ? palette : (PALETTES[palette]?.swatch[0] || '#15110c');
            return (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 6px',
                  borderRadius: 5,
                  border: isCustomPalette ? `1px solid ${HPR.amber}` : '1px solid transparent',
                  background: isCustomPalette ? mix(HPR.amber, 8) : 'transparent',
                  position: 'relative',
                }}
              >
                <span style={{ display: 'flex', position: 'relative', width: 42, height: 14 }}>
                  <span
                    style={{
                      width: 42,
                      height: 14,
                      background: 'linear-gradient(to right, #1a1a2e, #16213e, #0f3460)',
                      borderRadius: '3px',
                      border: `1px solid ${HPR.hairline2}`,
                    }}
                  />
                  <input
                    type="color"
                    value={currentPaletteHex}
                    onChange={(e) => setPalette(e.target.value)}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      opacity: 0,
                      cursor: 'pointer',
                    }}
                  />
                </span>
                <span style={{ fontSize: 11, color: isCustomPalette ? HPR.fg : HPR.fgMute, flex: 1 }}>
                  Custom Color
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="text"
                    value={currentPaletteHex}
                    onChange={(e) => {
                      let val = e.target.value;
                      if (!val.startsWith('#')) val = '#' + val;
                      if (val.length <= 7) {
                        setPalette(val);
                      }
                    }}
                    placeholder="#15110C"
                    style={{
                      width: 70,
                      fontSize: 10,
                      fontFamily: FONT_MONO,
                      background: HPR.ink,
                      color: HPR.fg,
                      border: `1px solid ${HPR.hairline2}`,
                      borderRadius: 4,
                      padding: '1px 3px',
                      outline: 'none',
                      textAlign: 'center',
                    }}
                  />
                  {isCustomPalette && (
                    <span style={{ color: HPR.amber, fontSize: 10 }}>●</span>
                  )}
                </div>
              </div>
            );
          })()}
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

      <InspectorBlock label="Text" sub="primary / muted / subtle">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <TextTonePicker
            label="Primary"
            value={fgOverride}
            fallback={paletteDefaults.fg}
            onChange={setFg}
          />
          <TextTonePicker
            label="Muted"
            value={fgMuteOverride}
            fallback={paletteDefaults.fgMute}
            onChange={setFgMute}
          />
          <TextTonePicker
            label="Subtle"
            value={fgSubtleOverride}
            fallback={paletteDefaults.fgSubtle}
            onChange={setFgSubtle}
          />
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

interface TextTonePickerProps {
  label: string;
  value: string | undefined;
  fallback: string;
  onChange: (val: string | undefined) => void;
}

function TextTonePicker({ label, value, fallback, onChange }: TextTonePickerProps) {
  const isOverridden = typeof value === 'string' && value.length > 0;
  const displayHex = isOverridden ? value : fallback;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 42,
          fontSize: 10,
          color: isOverridden ? HPR.fg : HPR.fgMute,
          fontFamily: FONT_MONO,
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </span>
      <div
        style={{
          position: 'relative',
          width: 24,
          height: 24,
          borderRadius: 5,
          background: displayHex,
          border: `1px solid ${HPR.hairline2}`,
          flexShrink: 0,
          cursor: 'pointer',
        }}
      >
        <input
          type="color"
          value={displayHex}
          onChange={(e) => onChange(e.target.value)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: 0,
            cursor: 'pointer',
          }}
          aria-label={`${label} text color`}
        />
      </div>
      <input
        type="text"
        value={displayHex}
        onChange={(e) => {
          let val = e.target.value;
          if (!val.startsWith('#')) val = '#' + val;
          if (val.length <= 7) {
            onChange(val);
          }
        }}
        placeholder={fallback}
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 10,
          fontFamily: FONT_MONO,
          background: HPR.ink,
          color: isOverridden ? HPR.fg : HPR.fgMute,
          border: `1px solid ${HPR.hairline2}`,
          borderRadius: 4,
          padding: '2px 4px',
          outline: 'none',
        }}
      />
      {isOverridden && (
        <button
          type="button"
          aria-label={`Reset ${label} text color`}
          title="Reset to palette default"
          onClick={() => onChange(undefined)}
          style={{
            background: 'transparent',
            border: 'none',
            color: HPR.fgSubtle,
            fontSize: 12,
            cursor: 'pointer',
            padding: 0,
            lineHeight: 1,
          }}
        >
          ↺
        </button>
      )}
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
