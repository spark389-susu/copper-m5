// @vitest-environment node
// npm run eval: asks Ask Copper every question in the golden set, has an AI
// judge (Gemini) mark each answer, and saves the answers, traces and scores in
// Langfuse as one run of the "copper-golden-set" dataset. The run fails if too
// few answers pass, so it can also block a pull request.
// Needs GOOGLE_GENERATIVE_AI_API_KEY and the Langfuse keys in .env.local.
import { existsSync } from "node:fs";
import { LangfuseClient } from "@langfuse/client";
import { describe, expect, it } from "vitest";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const MIN_PASS_RATE = Number(process.env.EVAL_MIN_PASS_RATE ?? "0.75");

describe("Ask Copper golden set", () => {
  it("passes the AI judge often enough", async () => {
    const { isAiConfigured } = await import("@/lib/ai/call");
    const { flushLangfuse, isLangfuseConfigured, startLangfuse } =
      await import("@/lib/ai/langfuse");
    const { GOLDEN_DATASET, GOLDEN_SET } =
      await import("@/lib/evals/golden-set");
    const { judgeAnswer, scoresFor, toolCheck } =
      await import("@/lib/evals/judge");
    const { runAskCopper } = await import("@/lib/evals/run-ask-copper");

    if (!isAiConfigured())
      throw new Error("Add GOOGLE_GENERATIVE_AI_API_KEY to .env.local first.");
    if (!isLangfuseConfigured())
      throw new Error(
        "Add LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL to .env.local first.",
      );

    // Traces: every Ask Copper call and judge call in this run goes to Langfuse.
    startLangfuse();
    const langfuse = new LangfuseClient();

    // The golden set as a Langfuse dataset. Items keep their ids, so running
    // again updates them instead of adding copies.
    await langfuse.api.datasets.create({
      name: GOLDEN_DATASET,
      description:
        "Questions with known answers for Ask Copper, marked by an AI judge.",
    });
    for (const item of GOLDEN_SET) {
      await langfuse.dataset.createItem({
        datasetName: GOLDEN_DATASET,
        id: item.id,
        input: { question: item.question, support: item.support ?? false },
        expectedOutput: item.expected,
        metadata: {
          category: item.category,
          expectedTools: item.expectedTools ?? [],
        },
      });
    }

    const dataset = await langfuse.dataset.get(GOLDEN_DATASET);
    const result = await dataset.runExperiment({
      name: "Ask Copper golden set",
      description: "Ask Copper (Copper + Refund agent), judged by Gemini.",
      task: async ({ input }) =>
        runAskCopper(input as { question: string; support?: boolean }),
      evaluators: [
        async ({ input, output, expectedOutput, metadata }) => {
          const item = {
            question: (input as { question: string }).question,
            expected: String(expectedOutput),
          };
          const out = output as Awaited<ReturnType<typeof runAskCopper>>;
          const verdict = await judgeAnswer(item, out);
          const tools = toolCheck(
            (metadata as { expectedTools?: string[] })?.expectedTools,
            out,
          );
          return scoresFor(verdict, tools, out.status === "done");
        },
      ],
      runEvaluators: [
        async ({ itemResults }) => {
          const passed = itemResults.filter((r) =>
            r.evaluations.some((e) => e.name === "passed" && e.value === 1),
          ).length;
          return {
            name: "pass_rate",
            value: itemResults.length ? passed / itemResults.length : 0,
            comment: `${passed} of ${itemResults.length} answers passed`,
          };
        },
      ],
      // A few at a time keeps within the free Gemini rate limit.
      maxConcurrency: 2,
    });

    console.log(await result.format({ includeItemResults: true }));
    if (result.experimentUrl) console.log(`Langfuse: ${result.experimentUrl}`);
    await langfuse.flush();
    await flushLangfuse();

    const rate = result.runEvaluations.find((e) => e.name === "pass_rate");
    expect(rate?.value, "pass rate").toBeGreaterThanOrEqual(MIN_PASS_RATE);
  }, 900_000);
});
