import { defineConfig } from "vitest/config";

// npm run eval: the golden-set evaluation. It calls real models, so it isn't
// part of npm test (vitest.config.mts only picks up *.test.ts files).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    testTimeout: 900_000,
  },
});
