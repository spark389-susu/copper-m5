// Next.js runs register() once when the server starts. It switches on Langfuse
// tracing, but only when the Langfuse keys are set, so the app still runs
// without them.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLangfuse } = await import("@/lib/ai/langfuse");
  startLangfuse();
}
