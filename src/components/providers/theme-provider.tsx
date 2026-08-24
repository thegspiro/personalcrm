"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}

export const ACCENTS = ["violet", "blue", "teal", "emerald", "amber", "rose"] as const;
export type Accent = (typeof ACCENTS)[number];

export const DENSITIES = ["comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

const ACCENT_KEY = "pcrm-accent";
const DENSITY_KEY = "pcrm-density";

/**
 * Applies the account's accent and density to <html>.
 *
 * The value comes from the database (so it follows the user across devices) but
 * is mirrored into localStorage and re-applied by an inline script before first
 * paint, which is what stops the accent flashing on load.
 */
export function AppearanceSync({ accent, density }: { accent: string; density: string }) {
  React.useEffect(() => {
    const root = document.documentElement;
    root.dataset.accent = accent;
    root.dataset.density = density;
    try {
      localStorage.setItem(ACCENT_KEY, accent);
      localStorage.setItem(DENSITY_KEY, density);
    } catch {
      // Private browsing or blocked storage — the server value still applied.
    }
  }, [accent, density]);

  return null;
}

/** Runs before paint; kept tiny and dependency-free on purpose. */
export const appearanceBootScript = `
(function(){try{
var a=localStorage.getItem("${ACCENT_KEY}");if(a)document.documentElement.dataset.accent=a;
var d=localStorage.getItem("${DENSITY_KEY}");if(d)document.documentElement.dataset.density=d;
}catch(e){}})();
`.trim();
