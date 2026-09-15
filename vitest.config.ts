import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.tsx"],
    // The PoC scaffold ships with no tests yet. Adapter contract tests,
    // snapshot-job tests, and metrics-math tests land per FSD §13 as those
    // modules are built. Don't fail CI on an intentionally empty suite.
    passWithNoTests: true,
  },
});
