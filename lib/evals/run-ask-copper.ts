import { trackUsage } from "@/lib/ai/usage";
import { askCopper, type Setup } from "@/lib/copper/assistant/ask";
import { type Agent, toolCallsOf } from "@/lib/copper/assistant/progress";
import { DEFAULT_LIMIT_USD } from "@/lib/copper/orders";
import type { GoldenItem } from "@/lib/evals/golden-set";

/** What Ask Copper did for one question: the reply and the tools it used. */
export type AskCopperOutput = {
  reply: string;
  status: "done" | "error" | "working";
  /** Who wrote the reply: Copper, or the Refund agent after a handoff. */
  agent: Agent;
  toolCalls: { name: string; input?: unknown; output?: unknown }[];
  /** What the answer cost: every model call made for it, and how long it took. */
  costUsd: number;
  latencyMs: number;
  modelCalls: number;
  tokens: number;
};

/**
 * Asks Ask Copper one golden question, the same way the chat panel does, and
 * waits for the whole answer. On the Support page (`support`) Copper can hand
 * refunds to the Refund agent, with the console's usual $50 limit.
 */
export async function runAskCopper(
  item: Pick<GoldenItem, "question" | "support">,
  setup: Setup = "two-agents",
): Promise<AskCopperOutput> {
  const started = performance.now();
  const { result: last, calls } = await trackUsage(async () => {
    const { progress } = await askCopper({
      messages: [{ role: "user", content: item.question }],
      useTools: true,
      setup,
      desk: item.support
        ? { limitUsd: DEFAULT_LIMIT_USD, refunds: [] }
        : undefined,
    });
    // Each update carries the whole answer so far; the last one is the finished answer.
    let chunk = await progress;
    while (chunk.next) chunk = await chunk.next;
    return chunk.value;
  });
  return {
    reply: last.reply,
    status: last.status,
    agent: last.agent ?? "copper",
    toolCalls: toolCallsOf(last),
    costUsd: calls.reduce((sum, c) => sum + (c.cost_usd ?? 0), 0),
    latencyMs: Math.round(performance.now() - started),
    modelCalls: calls.length,
    tokens: calls.reduce(
      (sum, c) => sum + (c.input_tokens ?? 0) + (c.output_tokens ?? 0),
      0,
    ),
  };
}
