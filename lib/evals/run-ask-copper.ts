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
  const last = chunk.value;
  return {
    reply: last.reply,
    status: last.status,
    agent: last.agent ?? "copper",
    toolCalls: toolCallsOf(last),
  };
}
