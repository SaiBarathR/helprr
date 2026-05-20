export interface PaletteTokens {
  ink: string;
  inkSoft: string;
  surface: string;
  surfaceHi: string;
  hairline: string;
  hairline2: string;
  fg: string;
  fgMute: string;
  fgSubtle: string;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex.split('').map((x) => x + x).join('');
  }
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k_n = k(n);
    const color = l - a * Math.max(Math.min(k_n - 3, 9 - k_n, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function generatePaletteFromBase(baseHex: string, accentHex: string): PaletteTokens {
  const normalizedBase = baseHex.startsWith('#') ? baseHex : `#${baseHex}`;
  const normalizedAccent = accentHex.startsWith('#') ? accentHex : `#${accentHex}`;

  let baseHsl;
  try {
    baseHsl = hexToHsl(normalizedBase);
  } catch {
    baseHsl = { h: 30, s: 20, l: 8 }; // Fallback to warm ink base
  }

  const { h, s, l } = baseHsl;
  const isDark = l < 50;

  let r = 245, g = 185, b = 72; // default accent rgb
  try {
    r = parseInt(normalizedAccent.substring(1, 3), 16);
    g = parseInt(normalizedAccent.substring(3, 5), 16);
    b = parseInt(normalizedAccent.substring(5, 7), 16);
  } catch {
    // keep defaults
  }

  if (isDark) {
    // Generate a cohesive premium dark-mode palette
    const ink = hslToHex(h, s, Math.max(0, l - 5));
    const inkSoft = hslToHex(h, s, l);
    const surface = hslToHex(h, s, Math.min(100, l + 5));
    const surfaceHi = hslToHex(h, s, Math.min(100, l + 10));

    const fg = hslToHex(h, Math.max(0, s - 10), 94);
    const fgMute = hslToHex(h, Math.max(0, s - 15), 72);
    const fgSubtle = hslToHex(h, Math.max(0, s - 20), 50);

    const hairline = `rgba(${r}, ${g}, ${b}, 0.09)`;
    const hairline2 = `rgba(${r}, ${g}, ${b}, 0.16)`;

    return {
      ink,
      inkSoft,
      surface,
      surfaceHi,
      hairline,
      hairline2,
      fg,
      fgMute,
      fgSubtle,
    };
  } else {
    // Generate a cohesive premium light-mode palette
    const ink = hslToHex(h, s, Math.min(100, l + 5));
    const inkSoft = hslToHex(h, s, l);
    const surface = hslToHex(h, s, Math.max(0, l - 5));
    const surfaceHi = hslToHex(h, s, Math.max(0, l - 10));

    const fg = hslToHex(h, Math.max(0, s - 10), 12);
    const fgMute = hslToHex(h, Math.max(0, s - 15), 35);
    const fgSubtle = hslToHex(h, Math.max(0, s - 20), 55);

    const hairline = `rgba(${r}, ${g}, ${b}, 0.12)`;
    const hairline2 = `rgba(${r}, ${g}, ${b}, 0.22)`;

    return {
      ink,
      inkSoft,
      surface,
      surfaceHi,
      hairline,
      hairline2,
      fg,
      fgMute,
      fgSubtle,
    };
  }
}
