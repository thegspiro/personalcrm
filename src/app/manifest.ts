import type { MetadataRoute } from "next";

/**
 * The install manifest.
 *
 * `src/app/layout.tsx` has advertised `/manifest.webmanifest` since Phase 1
 * with nothing behind it, so every page load has been fetching a 404. This is
 * that file.
 *
 * `display: "standalone"` is the point of the exercise: added to a home
 * screen, the app gets the full viewport with no browser chrome, which on a
 * phone is the difference between a website and something you actually reach
 * for.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // The install identity. Without it the browser keys the installed app on
    // start_url, so changing that later would orphan every copy already on a
    // home screen instead of updating it.
    id: "/",
    name: "Personal CRM",
    short_name: "CRM",
    description: "Keep track of the people in your life.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Falls back to a trimmed browser window where standalone is unavailable,
    // rather than all the way to a normal tab.
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#fafafa",
    theme_color: "#fafafa",
    categories: ["productivity", "lifestyle"],
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        // Maskable so Android crops it to the launcher's shape instead of
        // dropping a square badge onto a round icon.
        purpose: "maskable",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
    shortcuts: [
      { name: "Log an interaction", url: "/?log=1" },
      { name: "Add someone", url: "/people/new" },
      { name: "Timeline", url: "/timeline" },
    ],
  };
}
