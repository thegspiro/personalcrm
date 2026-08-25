import next from "eslint-config-next/core-web-vitals";

/**
 * ESLint flat config.
 *
 * `next lint` is deprecated and, with no config on disk, prompts interactively
 * for one — which hangs a CI job rather than failing it. The ESLint CLI is the
 * supported path, so `npm run lint` runs `eslint .` against this file.
 *
 * eslint-config-next 16 ships the React Compiler rule set, which flags three
 * patterns this codebase uses deliberately. They are warnings rather than
 * errors so that lint is a gate that can actually be enforced, and the
 * remaining rules — rules-of-hooks included — still fail the build:
 *
 *  * `react-hooks/set-state-in-effect` — the `mounted` pattern behind every
 *    theme-aware control. The theme is only known after hydration, and
 *    rendering the buttons unselected until then was a real bug (Phase 4a).
 *  * `react-hooks/purity` — `Date.now()` in a client component rendering a
 *    relative day count.
 *  * `react-hooks/immutability` — writing `document.documentElement.dataset`
 *    so an accent or density change is visible before the action returns.
 *
 * Each is worth revisiting; none is worth blocking every future change on.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "prisma/migrations/**",
      "public/sw.js",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...next,
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
];

export default config;
