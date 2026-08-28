/**
 * Ambient colour for the cinematic billboard, sampled from its artwork.
 *
 * The site does not paint a fixed black ramp behind its hero. It renders an
 * inline SVG radial gradient whose first stop is a dark, low-chroma colour
 * taken from the current backdrop — a blue-grey still gives `#152433`, a red
 * one gives a dark red — fading to transparent by 65%. Reloading the page
 * changes the wash with the title, which is what makes the whole page feel
 * lit by the artwork rather than pasted on top of it.
 */

/**
 * Dark enough to stay a ground for white text, light enough to read as a
 * colour rather than as the page's own #141414.
 */
const WASH_LIGHTNESS = 0.17;
/**
 * The floor is what makes the wash legible as a *derived* colour.
 *
 * At 0.12 a desaturated poster sampled to rgb(34,40,31) — a green in name only,
 * indistinguishable from the ground, so the wash looked like it was not
 * working at all. The site's washes read plainly as green, red or teal; this
 * floor is what carries that. The ceiling still stops a neon key art from
 * glowing.
 */
const MIN_SATURATION = 0.32;
const MAX_SATURATION = 0.5;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const value = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * value);
  };
  return `#${[hue(0), hue(8), hue(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The wash colour for a downsampled frame of RGBA pixels.
 *
 * Pixels are weighted by their own saturation so a poster's one vivid area
 * decides the hue rather than being averaged away by the grey around it —
 * a plain mean turns almost every image into the same muddy brown. The result
 * is then forced dark and its chroma clamped, because this is a ground to read
 * white text on, not an accent.
 */
export function washColorFromPixels(pixels: Uint8ClampedArray): string {
  let weight = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < 128) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const [, s, l] = rgbToHsl(r, g, b);
    // Near-black and blown-out pixels carry no usable hue.
    if (l < 0.06 || l > 0.95) continue;
    const w = 0.15 + s;
    rSum += r * w;
    gSum += g * w;
    bSum += b * w;
    weight += w;
  }

  // An all-black or fully transparent frame has nothing to say; the caller
  // falls back to the plain ground.
  if (weight === 0) return '#000000';

  const [h, s] = rgbToHsl(rSum / weight, gSum / weight, bSum / weight);
  return hslToHex(h, Math.min(MAX_SATURATION, Math.max(MIN_SATURATION, s)), WASH_LIGHTNESS);
}

/**
 * The site's wash, rebuilt: a radial gradient anchored above the top edge,
 * solid at 20% and gone by 65%. Measured from the inline SVG it ships.
 */
export function washGradient(color: string): string {
  return `radial-gradient(120% 80% at 50% -10%, ${color} 20%, rgba(0, 0, 0, 0) 65%)`;
}

/** Downsamples an image and returns its wash colour, or null if unreadable. */
export async function sampleWashColor(src: string): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  try {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = src;
    await image.decode();

    // A thumbnail is plenty: the hue survives downsampling and reading a full
    // backdrop back out of a canvas is needlessly expensive.
    const width = 32;
    const height = 18;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    const color = washColorFromPixels(context.getImageData(0, 0, width, height).data);
    return color === '#000000' ? null : color;
  } catch {
    // A tainted canvas or a failed decode simply means no wash.
    return null;
  }
}
