import type { LangfuseClient } from "@langfuse/client";
import type { Setup } from "@/lib/copper/assistant/ask";
import { GOLDEN_DATASET, GOLDEN_SET } from "@/lib/evals/golden-set";
import { judgeAnswer, scoresFor, toolCheck } from "@/lib/evals/judge";
import { expectedToolsFor } from "@/lib/evals/compare";
import { runAskCopper, type AskCopperOutput } from "@/lib/evals/run-ask-copper";
import { type Row, summarize } from "@/lib/evals/summary";

/** The golden set as a Langfuse dataset. Items keep their ids, so running again updates them. */
export async function ensureGoldenDataset(langfuse: LangfuseClient) {
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
  return langfuse.dataset.get(GOLDEN_DATASET);
}

type Dataset = Awaited<ReturnType<LangfuseClient["dataset"]["get"]>>;

/**
 * One run of the golden set: Ask Copper answers every question (with the given
 * setup), the AI judge marks each answer, and Langfuse stores the answers and
 * scores. Also returns the run's pass rate, cost and speed.
 */
export async function runGoldenSet(
  dataset: Dataset,
  options: { name: string; description: string; setup: Setup },
) {
  const { name, description, setup } = options;
  const result = await dataset.runExperiment({
    name,
    description,
    task: async ({ input }) =>
      runAskCopper(input as { question: string; support?: boolean }, setup),
    evaluators: [
      async ({ input, output, expectedOutput, metadata }) => {
        const out = output as AskCopperOutput;
        const verdict = await judgeAnswer(
          {
            question: (input as { question: string }).question,
            expected: String(expectedOutput),
          },
          out,
        );
        const tools = toolCheck(
          expectedToolsFor(
            setup,
            (metadata as { expectedTools?: string[] })?.expectedTools,
          ),
          out,
        );
        return [
          ...scoresFor(verdict, tools, out.status === "done"),
          // Cost and speed of the answer itself (not of the judge).
          { name: "cost_usd", value: out.costUsd },
          { name: "latency_s", value: out.latencyMs / 1000 },
        ];
      },
    ],
    runEvaluators: [
      async ({ itemResults }) => {
        const summary = summarize(name, rowsOf(itemResults));
        return [
          {
            name: "pass_rate",
            value: summary.passRate,
            comment: `${summary.passed} of ${summary.answers} answers passed`,
          },
          { name: "avg_cost_usd", value: summary.avgCostUsd },
          { name: "avg_latency_s", value: summary.avgLatencyS },
        ];
      },
    ],
    // A few at a time keeps within the free Gemini rate limit.
    maxConcurrency: 2,
  });
  const summary = summarize(name, rowsOf(result.itemResults));
  return { result, summary };
}

type ItemResult = {
  output: unknown;
  evaluations: { name: string; value: unknown }[];
};

function rowsOf(itemResults: ItemResult[]): Row[] {
  return itemResults.map((r) => {
    const out = r.output as AskCopperOutput;
    return {
      passed: r.evaluations.some((e) => e.name === "passed" && e.value === 1),
      costUsd: out?.costUsd ?? 0,
      latencyMs: out?.latencyMs ?? 0,
      tokens: out?.tokens ?? 0,
      modelCalls: out?.modelCalls ?? 0,
    };
  });
}
