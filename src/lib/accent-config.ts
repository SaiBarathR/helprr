/**
 * Accent color presets for the Helprr "Projector Booth" UI.
 *
 * Each preset overrides --primary, --ring, --amber*, --sidebar-primary*,
 * --chart-1 in both light and dark modes via [data-accent="..."] CSS rules
 * defined in globals.css.
 *
 * Accent is persisted per-device via Zustand localStorage, so the user can
 * pick a different accent on mobile vs desktop automatically.
 */

export type AccentId =
  | 'amber'
  | 'crimson'
  | 'sage'
  | 'sky'
  | 'magenta'
  | 'lime'
  | 'slate';

export interface AccentPreset {
  id: AccentId;
  label: string;
  description: string;
  /** Swatch shown in the picker — uses the dark-mode OKLCH for visibility */
  swatch: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  {
    id: 'amber',
    label: 'Projector Amber',
    description: 'Warm cinema gold — the house color.',
    swatch: 'oklch(0.80 0.15 70)',
  },
  {
    id: 'crimson',
    label: 'Reel Crimson',
    description: 'Hot lamp red — film-strip warning.',
    swatch: 'oklch(0.66 0.20 25)',
  },
  {
    id: 'sage',
    label: 'Emulsion Sage',
    description: 'Cool natural green — like aged film stock.',
    swatch: 'oklch(0.74 0.13 162)',
  },
  {
    id: 'sky',
    label: 'Cyan Print',
    description: 'Projector cool blue — daylight balance.',
    swatch: 'oklch(0.72 0.14 235)',
  },
  {
    id: 'magenta',
    label: 'Gel Magenta',
    description: 'Stage-light magenta — synthwave booth.',
    swatch: 'oklch(0.70 0.19 320)',
  },
  {
    id: 'lime',
    label: 'Phosphor Lime',
    description: 'CRT phosphor green — terminal vibes.',
    swatch: 'oklch(0.85 0.18 130)',
  },
  {
    id: 'slate',
    label: 'Mono Slate',
    description: 'Neutral warm white — pure editorial.',
    swatch: 'oklch(0.85 0.012 80)',
  },
];

export const ACCENT_MAP: Record<AccentId, AccentPreset> = Object.fromEntries(
  ACCENT_PRESETS.map((p) => [p.id, p])
) as Record<AccentId, AccentPreset>;

export const DEFAULT_ACCENT: AccentId = 'amber';

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === 'string' && value in ACCENT_MAP;
}
