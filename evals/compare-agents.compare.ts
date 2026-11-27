// @vitest-environment node
// npm run eval:compare: runs the golden set twice, once with the two agents
// (Copper + Refund agent) and once with a single agent that does everything,
// and saves both as runs of the "copper-golden-set" dataset in Langfuse, so you
// can put them side by side (Datasets > copper-golden-set > Compare). Prints
// the pass rate, cost and speed of each. Each answer is marked by the same AI
// judge. Needs GOOGLE_GENERATIVE_AI_API_KEY and the Langfuse keys in .env.local.
import { existsSync } from "node:fs";
import { LangfuseClient } from "@langfuse/client";
import { describe, expect, it } from "vitest";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// Printed straight to the terminal, so vitest shows it even when the test passes.
const say = (text: string) => process.stdout.write(`${text}\n`);

describe("Single agent vs two agents", () => {
  it("runs the same golden set on both setups", async () => {
    const { isAiConfigured } = await import("@/lib/ai/call");
    const { flushLangfuse, isLangfuseConfigured, startLangfuse } =
      await import("@/lib/ai/langfuse");
    const { SETUPS } = await import("@/lib/evals/compare");
    const { ensureGoldenDataset, runGoldenSet } =
      await import("@/lib/evals/experiment");
    const { summaryTable, writeJobSummary } =
      await import("@/lib/evals/summary");

    if (!isAiConfigured())
      throw new Error("Add GOOGLE_GENERATIVE_AI_API_KEY to .env.local first.");
    if (!isLangfuseConfigured())
      throw new Error(
        "Add LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL to .env.local first.",
      );

    startLangfuse();
    const langfuse = new LangfuseClient();
    const dataset = await ensureGoldenDataset(langfuse);

    const summaries = [];
    for (const setup of SETUPS) {
      const { result, summary } = await runGoldenSet(dataset, {
        name: `Ask Copper: ${setup.label}`,
        description: setup.description,
        setup: setup.id,
      });
      if (result.experimentUrl)
        say(`Langfuse (${setup.label}): ${result.experimentUrl}`);
      summaries.push(summary);
    }

    const table = summaryTable(summaries);
    say(`\n${table}\n`);
    writeJobSummary(`## Single agent vs two agents\n\n${table}\n`);
    await langfuse.flush();
    await flushLangfuse();
    expect(summaries).toHaveLength(SETUPS.length);
  }, 1_800_000);
});
