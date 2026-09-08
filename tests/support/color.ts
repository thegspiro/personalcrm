/**
 * Colour maths for the contrast checks.
 *
 * Validated against axe's own reported numbers: for the calendar cell that
 * failed the end-to-end sweep, axe measured 4.36 and this reproduces 4.37. It
 * exists because a sweep can only measure what happens to be rendered, and a
 * colour nobody has used yet is exactly the one nobody has looked at.
 */

export type Rgb = readonly [number, number, number];

/** oklch, as CSS writes it, to linear-encoded sRGB in 0..1. */
export function oklchToSrgb(L: number, C: number, H: number): Rgb {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const encode = (value: number) => {
    const clamped = Math.min(1, Math.max(0, value));
    return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
  };

  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** `oklch(63.7% 0.237 25.331)` or `oklch(0.62 0.15 155)`, either notation. */
export function parseOklch(value: string): Rgb | null {
  const match = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i.exec(value);
  if (!match) return null;
  const lightness = Number(match[1]) / (match[2] === "%" ? 100 : 1);
  return oklchToSrgb(lightness, Number(match[3]), Number(match[4]));
}

function channel(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(channel) as unknown as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(foreground: Rgb, background: Rgb): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** `foreground` at `alpha` composited over an opaque `background`. */
export function over(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
  ];
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Every `--name: oklch(...)` in a block of CSS, last definition winning. */
export function readTokens(css: string): Map<string, Rgb> {
  const out = new Map<string, Rgb>();
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*(oklch\([^)]*\))/gi)) {
    const rgb = parseOklch(match[2]!);
    if (rgb) out.set(match[1]!, rgb);
  }
  return out;
}

/**
 * The `:root` / `.dark` block a token should be read from.
 *
 * Matched as "the selector, then a brace" rather than by plain substring: the
 * stylesheet opens with `@custom-variant dark (&:is(.dark *));`, so searching
 * for `.dark` finds that line first and reads the wrong block entirely — which
 * silently returns the light tokens and makes every dark-mode assertion
 * measure light-mode colours.
 */
export function blockOf(css: string, selector: string): string {
  const anchor = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`);
  const found = anchor.exec(css);
  if (!found) throw new Error(`no ${selector} block`);
  const start = found.index;
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open, i);
    }
  }
  throw new Error(`unterminated ${selector} block`);
}
