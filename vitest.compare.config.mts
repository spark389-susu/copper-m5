import { defineConfig } from "vitest/config";

// npm run eval:compare: the single agent vs two agents comparison. It runs the
// golden set twice against real models, so it is separate from npm run eval
// (which runs on every pull request).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["evals/**/*.compare.ts"],
    testTimeout: 1_800_000,
  },
});
