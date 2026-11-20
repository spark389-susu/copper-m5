import type { Setup } from "@/lib/copper/assistant/ask";

// The two ways to staff Ask Copper that the comparison runs (Module 5).
export const SETUPS: { id: Setup; label: string; description: string }[] = [
  {
    id: "two-agents",
    label: "two agents",
    description: "Copper hands refunds to the Refund agent.",
  },
  {
    id: "single",
    label: "single agent",
    description: "One agent with every tool and both sets of rules.",
  },
];

/** The single agent has no handoff tools, so it can't be marked down for not calling one. */
export function expectedToolsFor(
  setup: Setup,
  expectedTools: string[] | undefined,
): string[] | undefined {
  if (setup !== "single") return expectedTools;
  return expectedTools?.filter((name) => !name.startsWith("transfer_to_"));
}
