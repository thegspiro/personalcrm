import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // `server-only` throws on import unless the bundler sets the
      // "react-server" condition, which puts every module marked with it —
      // `actions/helpers.ts` among them — out of reach of the test runner.
      // Next resolves it to this same empty module on the server; pointing at
      // it directly lets a test exercise a server action for real instead of
      // reimplementing one and checking the copy.
      // Addressed as a file because the package's exports map keeps the empty
      // build private to the "react-server" condition.
      "server-only": fileURLToPath(new URL("node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Integration tests share one database, so they must not run concurrently.
    fileParallelism: false,
    setupFiles: ["tests/setup-env.ts"],
  },
});
