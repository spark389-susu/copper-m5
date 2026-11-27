import { AsyncLocalStorage } from "node:async_hooks";
import type { AiCallRow } from "@/lib/ai/call";

// Lets the evals add up what one Ask Copper answer cost: every model call made
// while `trackUsage` runs is collected, so the total cost, tokens and calls
// for that answer are known. Outside `trackUsage` nothing is collected.
const store = new AsyncLocalStorage<AiCallRow[]>();

/** Called for every model call (from lib/ai/call.ts). */
export function recordCall(row: AiCallRow): void {
  store.getStore()?.push(row);
}

/** Runs `run` and returns its result with every model call it made. */
export async function trackUsage<T>(
  run: () => Promise<T>,
): Promise<{ result: T; calls: AiCallRow[] }> {
  const calls: AiCallRow[] = [];
  const result = await store.run(calls, run);
  return { result, calls };
}
