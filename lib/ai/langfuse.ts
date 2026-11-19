import { OpenTelemetry } from "@ai-sdk/otel";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { registerTelemetry } from "ai";

// Langfuse (observability): every model call, agent turn and tool call is sent
// there as a trace, with its tokens, cost and how long it took.
// Keys: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL in .env.local.

export function isLangfuseConfigured(): boolean {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY?.trim() &&
    process.env.LANGFUSE_SECRET_KEY?.trim(),
  );
}

let started = false;
let processor: LangfuseSpanProcessor | undefined;

/** Starts tracing once. Does nothing (and the app still works) without keys. */
export function startLangfuse(): void {
  if (started || !isLangfuseConfigured()) return;
  started = true;
  processor = new LangfuseSpanProcessor({
    // Send spans promptly, so a trace shows up in Langfuse within seconds.
    exportMode: "immediate",
  });
  new NodeSDK({ spanProcessors: [processor] }).start();
  // The AI SDK reports each call, step and tool run to OpenTelemetry.
  registerTelemetry(new OpenTelemetry());
}

/** Sends any waiting spans now (for scripts that exit right after a call). */
export async function flushLangfuse(): Promise<void> {
  await processor?.forceFlush();
}
