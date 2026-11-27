import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { startActiveObservation } from "@langfuse/tracing";
import { embedMany, generateText, Output, streamText } from "ai";
import type { z } from "zod";
import {
  defaultModel,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  MODELS,
  type ModelId,
} from "@/lib/ai/models";
import { costUsd } from "@/lib/ai/pricing";
import { recordCall } from "@/lib/ai/usage";

// Every model call in the app goes through this file, so each one is logged
// with its tokens, cost and how long it took. The log goes to the terminal
// running the app, as a line starting "[ai_calls]". When the Langfuse keys are
// set (lib/ai/langfuse.ts), each call is also a trace in Langfuse: one span per
// call, carrying the same tokens, cost and latency, with the model call and
// any tool calls nested inside it.

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "Set up AI to use this feature: add GOOGLE_GENERATIVE_AI_API_KEY to .env.local.",
    );
    this.name = "AiNotConfiguredError";
  }
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}

/** Which module and feature made the call, for the ai_calls log. */
export type CallInfo = { module: number; feature: string; model?: ModelId };

// Omit that keeps generateText's "prompt or messages" union intact.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
type TextOptions = DistributiveOmit<
  Parameters<typeof generateText>[0],
  "model" | "output"
>;

export type AiCallRow = {
  module: number;
  feature: string;
  model: ModelId | typeof EMBEDDING_MODEL;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number;
  ok: boolean;
  created_at: string;
};

function google() {
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!googleKey) throw new AiNotConfiguredError();
  return createGoogleGenerativeAI({ apiKey: googleKey });
}

function languageModel(model: ModelId) {
  const entry = MODELS.find((m) => m.id === model);
  const id =
    entry && "googleId" in entry
      ? entry.googleId
      : model.slice("google/".length);
  return google()(id);
}

/** Prints one line per model call, so the cost and time are visible. */
async function logCall(row: AiCallRow): Promise<void> {
  console.info("[ai_calls]", JSON.stringify(row));
  recordCall(row);
}

type Usage = { inputTokens?: number; outputTokens?: number };

/** What the Langfuse span for a call shows, next to its input and output. */
function spanDetails(row: AiCallRow) {
  return {
    model: row.model,
    metadata: {
      module: row.module,
      feature: row.feature,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cost_usd: row.cost_usd,
      latency_ms: row.latency_ms,
    },
  };
}

type Span = Parameters<Parameters<typeof startActiveObservation>[1]>[0];

/** Marks a Langfuse span as failed. */
function failSpan(span: Span, error: unknown) {
  span.update({
    level: "ERROR",
    statusMessage: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Groups everything inside `run` into one Langfuse trace: use it around a
 * whole agent turn, so each agent's model calls and tool calls hang together.
 * Does nothing extra when Langfuse isn't set up.
 * Example: traceTurn("ask-copper-turn", { module: 4 }, () => runTheTurn())
 */
export function traceTurn<T>(
  name: string,
  metadata: Record<string, string | number | boolean>,
  run: () => Promise<T>,
): Promise<T> {
  return startActiveObservation(
    name,
    async (span) => {
      span.update({ metadata });
      try {
        return await run();
      } catch (error) {
        failSpan(span, error);
        throw error;
      }
    },
    { asType: "agent" },
  );
}

/** Builds the ai_calls row for a call that started at `started`. */
function rowFor(info: CallInfo, model: ModelId, started: number) {
  return (ok: boolean, usage?: Usage): AiCallRow => {
    const input = usage?.inputTokens ?? null;
    const output = usage?.outputTokens ?? null;
    return {
      module: info.module,
      feature: info.feature,
      model,
      input_tokens: input,
      output_tokens: output,
      cost_usd:
        input !== null && output !== null
          ? costUsd(model, input, output)
          : null,
      latency_ms: Math.round(performance.now() - started),
      ok,
      created_at: new Date().toISOString(),
    };
  };
}

async function tracked<T extends { usage: Usage }>(
  info: CallInfo,
  run: (model: ModelId) => Promise<T>,
): Promise<T> {
  const model = info.model ?? defaultModel();
  const row = rowFor(info, model, performance.now());
  return startActiveObservation(
    info.feature,
    async (span) => {
      try {
        const result = await run(model);
        const done = row(true, result.usage);
        span.update({ ...spanDetails(done), output: textOf(result) });
        await logCall(done);
        return result;
      } catch (error) {
        failSpan(span, error);
        if (!(error instanceof AiNotConfiguredError)) await logCall(row(false));
        throw error;
      }
    },
    { asType: "agent" },
  );
}

/** The reply text of a result, for the span's output. */
function textOf(result: object): string | undefined {
  return "text" in result && typeof result.text === "string"
    ? result.text
    : undefined;
}

/** Tells Langfuse which feature a model call belongs to. */
const telemetryFor = (info: { feature: string }) => ({
  functionId: info.feature,
});

/** Generates text. Example: callText({ module: 3, feature: "support-answer" }, { prompt }) */
export async function callText(info: CallInfo, options: TextOptions) {
  return tracked(info, (model) =>
    generateText({
      ...options,
      model: languageModel(model),
      telemetry: telemetryFor(info),
    }),
  );
}

/** Generates an object that matches a zod schema; read it from `result.output`. */
export async function callObject<Schema extends z.ZodType>(
  info: CallInfo,
  options: TextOptions & { schema: Schema },
) {
  const { schema, ...rest } = options;
  const result = await tracked(info, (model) =>
    generateText({
      ...rest,
      model: languageModel(model),
      telemetry: telemetryFor(info),
      output: Output.object({ schema }),
    }),
  );
  // Spreading `rest` loses generateText's output type; Output.object has
  // already validated it against `schema`, so restore the type here.
  return result as typeof result & { output: z.infer<Schema> };
}

/**
 * Embeds many texts in one go; read `result.embeddings` (same order as `values`).
 * Example: callEmbedMany({ module: 3, feature: "embed-docs" }, passages)
 */
export async function callEmbedMany(
  info: Omit<CallInfo, "model">,
  values: string[],
) {
  const started = performance.now();
  // Google doesn't report tokens for embeddings, so tokens and cost are null.
  const row = (ok: boolean): AiCallRow => ({
    module: info.module,
    feature: info.feature,
    model: EMBEDDING_MODEL,
    input_tokens: null,
    output_tokens: null,
    cost_usd: null,
    latency_ms: Math.round(performance.now() - started),
    ok,
    created_at: new Date().toISOString(),
  });
  return startActiveObservation(
    info.feature,
    async (span) => {
      try {
        const result = await embedMany({
          model: google().embedding(EMBEDDING_MODEL.slice("google/".length)),
          values,
          telemetry: telemetryFor(info),
          providerOptions: {
            google: { outputDimensionality: EMBEDDING_DIMENSIONS },
          },
        });
        const done = row(true);
        span.update({ ...spanDetails(done), input: { count: values.length } });
        await logCall(done);
        return result;
      } catch (error) {
        failSpan(span, error);
        if (!(error instanceof AiNotConfiguredError)) await logCall(row(false));
        throw error;
      }
    },
    { asType: "agent" },
  );
}

type StreamOptions = DistributiveOmit<
  Parameters<typeof streamText>[0],
  "model" | "output" | "onFinish" | "onError"
>;

/**
 * Streams a reply: read `result.fullStream` to see each step as it happens
 * (thinking, tool calls, tool results, text). Logged to ai_calls when it ends.
 * Example: callStream({ module: 2, feature: "ask-copper" }, { messages })
 */
export function callStream(info: CallInfo, options: StreamOptions) {
  const model = info.model ?? defaultModel();
  const row = rowFor(info, model, performance.now());
  // The span stays open until the stream ends, so it times the whole reply.
  return startActiveObservation(
    info.feature,
    (span) => {
      const finish = (ok: boolean, usage?: Usage, error?: unknown) => {
        const done = row(ok, usage);
        if (ok) span.update(spanDetails(done));
        else {
          span.update(spanDetails(done));
          failSpan(span, error);
        }
        span.end();
        return logCall(done);
      };
      return streamText({
        ...options,
        model: languageModel(model),
        telemetry: telemetryFor(info),
        onFinish: ({ totalUsage, text }) => {
          span.update({ output: text });
          return finish(true, totalUsage);
        },
        onError: ({ error }) => finish(false, undefined, error),
      });
    },
    { asType: "agent", endOnExit: false },
  );
}

// Asking for some thinking (rather than letting the model decide) is what
// makes Gemini write a summary even for an easy question.
const THINKING = { includeThoughts: true, thinkingBudget: 1024 };

/**
 * Asks Gemini to include a summary of its thinking in the stream (as
 * reasoning parts). Other models ignore it. Pass as `providerOptions`.
 */
export const THOUGHT_SUMMARIES = {
  google: { thinkingConfig: THINKING },
};
