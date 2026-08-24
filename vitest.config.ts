import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Integration tests share one database, so they must not run concurrently.
    fileParallelism: false,
    setupFiles: ["tests/setup-env.ts"],
  },
});
