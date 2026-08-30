import next from "eslint-config-next/core-web-vitals";

/**
 * ESLint flat config.
 *
 * `next lint` is deprecated and, with no config on disk, prompts interactively
 * for one — which hangs a CI job rather than failing it. The ESLint CLI is the
 * supported path, so `npm run lint` runs `eslint .` against this file.
 *
 * Keep the React Compiler checks explicit and fatal. These previously had
 * repository-wide warning downgrades, which let new violations accumulate
 * while CI still appeared green.
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
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/purity": "error",
      "react-hooks/immutability": "error",
    },
  },
];

export default config;
