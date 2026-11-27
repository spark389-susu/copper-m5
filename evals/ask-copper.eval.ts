// @vitest-environment node
// npm run eval: asks Ask Copper every question in the golden set, has an AI
// judge (Gemini) mark each answer, and saves the answers, traces and scores in
// Langfuse as one run of the "copper-golden-set" dataset. The run fails if too
// few answers pass, so it can also block a pull request. The pass rate, cost
// and speed are also shown on the pull request's check page.
// Needs GOOGLE_GENERATIVE_AI_API_KEY and the Langfuse keys in .env.local.
import { existsSync } from "node:fs";
import { LangfuseClient } from "@langfuse/client";
import { describe, expect, it } from "vitest";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const MIN_PASS_RATE = Number(process.env.EVAL_MIN_PASS_RATE ?? "0.75");

// Printed straight to the terminal, so vitest shows it even when the test passes.
const say = (text: string) => process.stdout.write(`${text}\n`);

describe("Ask Copper golden set", () => {
  it("passes the AI judge often enough", async () => {
    const { isAiConfigured } = await import("@/lib/ai/call");
    const { flushLangfuse, isLangfuseConfigured, startLangfuse } =
      await import("@/lib/ai/langfuse");
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

    // Traces: every Ask Copper call and judge call in this run goes to Langfuse.
    startLangfuse();
    const langfuse = new LangfuseClient();
    const dataset = await ensureGoldenDataset(langfuse);

    const { result, summary } = await runGoldenSet(dataset, {
      name: "Ask Copper golden set",
      description: "Ask Copper (Copper + Refund agent), judged by Gemini.",
      setup: "two-agents",
    });

    const table = summaryTable([summary]);
    say(await result.format({ includeItemResults: true }));
    say(table);
    if (result.experimentUrl) say(`Langfuse: ${result.experimentUrl}`);
    writeJobSummary(
      `## Ask Copper golden-set eval\n\n${table}\n\n${
        result.experimentUrl
          ? `[Open the run in Langfuse](${result.experimentUrl})\n`
          : ""
      }`,
    );
    await langfuse.flush();
    await flushLangfuse();

    expect(summary.passRate, "pass rate").toBeGreaterThanOrEqual(MIN_PASS_RATE);
  }, 900_000);
});
