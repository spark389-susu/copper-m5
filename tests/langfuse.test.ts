// @vitest-environment node
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { setLangfuseTracerProvider } from "@langfuse/tracing";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callText, traceTurn } from "@/lib/ai/call";
import { isLangfuseConfigured } from "@/lib/ai/langfuse";

let model: MockLanguageModelV4;
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => Object.assign(() => model, {}),
}));

const exporter = new InMemorySpanExporter();

beforeEach(() => {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "AIza-test-key");
  vi.spyOn(console, "info").mockImplementation(() => {});
  exporter.reset();
  // NodeSDK sets this up in the real app: it keeps a turn's calls together.
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  // Langfuse's tracer reads from this provider, so the test sees the spans.
  setLangfuseTracerProvider(
    new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    }),
  );
  model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: "Hi" }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 1000,
          noCache: 1000,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 200, text: 200, reasoning: undefined },
      },
      warnings: [],
    }),
  });
});

afterEach(() => {
  setLangfuseTracerProvider(null);
  trace.disable();
  context.disable();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const attrs = () =>
  Object.assign({}, ...exporter.getFinishedSpans().map((s) => s.attributes));

describe("Langfuse tracing", () => {
  it("is on only when both keys are set", () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "");
    expect(isLangfuseConfigured()).toBe(false);
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-test");
    expect(isLangfuseConfigured()).toBe(false);
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-lf-test");
    expect(isLangfuseConfigured()).toBe(true);
  });

  it("makes a span per call with its tokens, cost and latency", async () => {
    await callText(
      { module: 2, feature: "review-radar", model: "google/gemini-2.5-flash" },
      { prompt: "Say hi" },
    );
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === "review-radar");
    expect(span).toBeDefined();
    const meta = Object.fromEntries(
      Object.entries(span!.attributes).filter(([k]) =>
        k.startsWith("langfuse.observation.metadata."),
      ),
    );
    expect(meta).toMatchObject({
      "langfuse.observation.metadata.module": "2",
      "langfuse.observation.metadata.input_tokens": "1000",
      "langfuse.observation.metadata.output_tokens": "200",
    });
    expect(Number(meta["langfuse.observation.metadata.cost_usd"])).toBeCloseTo(
      0.0008,
      9,
    );
    expect(
      Number(meta["langfuse.observation.metadata.latency_ms"]),
    ).toBeGreaterThanOrEqual(0);
  });

  it("marks a failed call as an error", async () => {
    model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("model down");
      },
    });
    await expect(
      callText({ module: 2, feature: "review-radar" }, { prompt: "x" }),
    ).rejects.toThrow();
    expect(attrs()["langfuse.observation.level"]).toBe("ERROR");
  });

  it("groups calls made inside a turn under one trace", async () => {
    await traceTurn("ask-copper-turn", { module: 4 }, async () => {
      await callText({ module: 4, feature: "refund-agent" }, { prompt: "a" });
      await callText({ module: 2, feature: "ask-copper" }, { prompt: "b" });
    });
    const spans = exporter.getFinishedSpans();
    const turn = spans.find((s) => s.name === "ask-copper-turn")!;
    const calls = spans.filter((s) =>
      ["refund-agent", "ask-copper"].includes(s.name),
    );
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.spanContext().traceId).toBe(turn.spanContext().traceId);
      expect(call.parentSpanContext?.spanId).toBe(turn.spanContext().spanId);
    }
  });
});
