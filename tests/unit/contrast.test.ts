import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TERM_COLOR_CLASSES } from "@/lib/format";
import {
  blockOf,
  contrast,
  over,
  readTokens,
  toHex,
  type Rgb,
} from "../support/color";

/**
 * Contrast, checked by arithmetic rather than by what happened to be on screen.
 *
 * `tests/e2e/a11y.spec.ts` runs axe over the real pages, which is the only way
 * to catch a background no token predicts — a translucent cell blending with
 * the grid lines behind it, say. But it can only measure what renders, and the
 * eighteen-colour term palette is mostly not rendered by any spec: a colour
 * nobody has used yet is exactly the one nobody has looked at.
 *
 * This closes that. Every entry in the palette, in both themes, plus the
 * semantic tokens on tints of themselves, against the 4.5:1 that small text
 * needs. Deterministic, exhaustive, and it runs in milliseconds.
 */

const AA_SMALL_TEXT = 4.5;

const appCss = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const tailwindCss = readFileSync(
  join(process.cwd(), "node_modules/tailwindcss/theme.css"),
  "utf8",
);

const tailwind = readTokens(tailwindCss);
const light = readTokens(blockOf(appCss, ":root"));
const dark = readTokens(blockOf(appCss, ".dark"));

function token(theme: Map<string, Rgb>, name: string): Rgb {
  const value = theme.get(name);
  if (!value) throw new Error(`token ${name} not found`);
  return value;
}

function shade(name: string, step: number): Rgb {
  const value = tailwind.get(`--color-${name}-${step}`);
  if (!value) throw new Error(`tailwind colour ${name}-${step} not found`);
  return value;
}

/** `bg-<name>-500/12` composited over the card it sits on. */
function tintedChip(name: string, card: Rgb): Rgb {
  return over(shade(name, 500), card, 0.12);
}

function parseClasses(classes: string) {
  const lightText = /(?:^|\s)text-(\w+)-(\d+)/.exec(classes);
  const darkText = /dark:text-(\w+)-(\d+)/.exec(classes);
  const tint = /bg-(\w+)-500\/(\d+)/.exec(classes);
  return { lightText, darkText, tint };
}

describe("the sanity of the maths", () => {
  it("reproduces the ratio axe measured on the calendar cell", () => {
    // axe reported 4.36 for #686c74 on #e8eaec before that cell was fixed.
    // Reproducing it is what makes the rest of this file trustworthy.
    const fg: Rgb = [0x68 / 255, 0x6c / 255, 0x74 / 255];
    const bg: Rgb = [0xe8 / 255, 0xea / 255, 0xec / 255];
    expect(contrast(fg, bg)).toBeCloseTo(4.36, 1);
  });

  it("reads a Tailwind colour and an app token", () => {
    expect(toHex(shade("red", 500))).toMatch(/^#[0-9a-f]{6}$/);
    expect(toHex(token(light, "--card"))).toBe("#ffffff");
  });
});

describe("term colours are readable on their own tint", () => {
  const lightCard = token(light, "--card");
  const darkCard = token(dark, "--card");

  for (const [name, classes] of Object.entries(TERM_COLOR_CLASSES)) {
    const { lightText, darkText, tint } = parseClasses(classes);

    it(`${name} in light mode`, () => {
      expect(lightText, `no light text shade in "${classes}"`).not.toBeNull();
      expect(tint, `no 500-tint background in "${classes}"`).not.toBeNull();

      const background = over(shade(tint![1]!, 500), lightCard, Number(tint![2]) / 100);
      const foreground = shade(lightText![1]!, Number(lightText![2]));
      const ratio = contrast(foreground, background);

      expect(
        ratio,
        `${name}: ${toHex(foreground)} on ${toHex(background)} is ${ratio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });

    it(`${name} in dark mode`, () => {
      expect(darkText, `no dark text shade in "${classes}"`).not.toBeNull();

      const background = over(shade(tint![1]!, 500), darkCard, Number(tint![2]) / 100);
      const foreground = shade(darkText![1]!, Number(darkText![2]));
      const ratio = contrast(foreground, background);

      expect(
        ratio,
        `${name}: ${toHex(foreground)} on ${toHex(background)} is ${ratio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
  }
});

describe("semantic colours are readable where they are used as text", () => {
  // The `-11` step exists for exactly this: `--success` and `--warning` are
  // chosen to be seen as a fill, and as small text on a tint of themselves they
  // managed 2.77 and 2.13.
  const cases = [
    { name: "success", tint: 0.18 },
    { name: "warning", tint: 0.2 },
    { name: "destructive", tint: 0.12 },
  ];

  for (const { name, tint } of cases) {
    for (const [themeName, theme] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      const card = token(theme, "--card");

      it(`${name}-11 on a ${Math.round(tint * 100)}% tint of itself, ${themeName}`, () => {
        const background = over(token(theme, `--${name}`), card, tint);
        const ratio = contrast(token(theme, `--${name}-11`), background);
        expect(ratio, `${name}-11 on its own tint is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
          AA_SMALL_TEXT,
        );
      });

      it(`${name}-11 on the card, ${themeName}`, () => {
        const ratio = contrast(token(theme, `--${name}-11`), card);
        expect(ratio, `${name}-11 on the card is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
          AA_SMALL_TEXT,
        );
      });
    }
  }
});

describe("the muted token, which every faded variant came from", () => {
  for (const [themeName, theme] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    it(`muted-foreground is readable on the card, ${themeName}`, () => {
      const ratio = contrast(token(theme, "--muted-foreground"), token(theme, "--card"));
      expect(ratio).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });

    it(`muted-foreground is readable on a muted cell, ${themeName}`, () => {
      // The calendar's neighbouring-month days. Opaque, because a translucent
      // one blended with the grid lines and landed at 4.36.
      const ratio = contrast(token(theme, "--muted-foreground"), token(theme, "--muted"));
      expect(ratio).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
  }
});
