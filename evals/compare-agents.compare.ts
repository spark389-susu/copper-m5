// @vitest-environment node
// npm run eval:compare: runs the golden set twice, once with the two agents
// (Copper + Refund agent) and once with a single agent that does everything,
// and saves both as runs of the "copper-golden-set" dataset in Langfuse, so you
// can put them side by side (Datasets > copper-golden-set > Compare).
// Each answer is marked by the same AI judge. Needs GOOGLE_GENERATIVE_AI_API_KEY
// and the Langfuse keys in .env.local.
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
    const { GOLDEN_DATASET, GOLDEN_SET } =
      await import("@/lib/evals/golden-set");
    const { judgeAnswer, scoresFor, toolCheck } =
      await import("@/lib/evals/judge");
    const { runAskCopper } = await import("@/lib/evals/run-ask-copper");
    const { SETUPS, expectedToolsFor } = await import("@/lib/evals/compare");

    if (!isAiConfigured())
      throw new Error("Add GOOGLE_GENERATIVE_AI_API_KEY to .env.local first.");
    if (!isLangfuseConfigured())
      throw new Error(
        "Add LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL to .env.local first.",
      );

    startLangfuse();
    const langfuse = new LangfuseClient();
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

    const rates: Record<string, number> = {};
    for (const setup of SETUPS) {
      const result = await dataset.runExperiment({
        name: `Ask Copper: ${setup.label}`,
        description: setup.description,
        task: async ({ input }) =>
          runAskCopper(
            input as { question: string; support?: boolean },
            setup.id,
          ),
        evaluators: [
          async ({ input, output, expectedOutput, metadata }) => {
            const out = output as Awaited<ReturnType<typeof runAskCopper>>;
            const verdict = await judgeAnswer(
              {
                question: (input as { question: string }).question,
                expected: String(expectedOutput),
              },
              out,
            );
            const tools = toolCheck(
              expectedToolsFor(
                setup.id,
                (metadata as { expectedTools?: string[] })?.expectedTools,
              ),
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
        maxConcurrency: 2,
      });
      say(await result.format({ includeItemResults: false }));
      if (result.experimentUrl)
        say(`Langfuse (${setup.label}): ${result.experimentUrl}`);
      const rate = result.runEvaluations.find((e) => e.name === "pass_rate");
      rates[setup.id] = Number(rate?.value ?? 0);
    }

    await langfuse.flush();
    await flushLangfuse();
    say(`Pass rate: ${JSON.stringify(rates)}`);
    expect(Object.keys(rates)).toHaveLength(SETUPS.length);
  }, 1_800_000);
});
