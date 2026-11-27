// @vitest-environment node
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOOL_LABELS } from "@/lib/copper/assistant/progress";
import { GOLDEN_SET } from "@/lib/evals/golden-set";
import {
  judgeAnswer,
  judgePrompt,
  scoresFor,
  toolCheck,
  type Verdict,
} from "@/lib/evals/judge";
import type { AskCopperOutput } from "@/lib/evals/run-ask-copper";

let model: MockLanguageModelV4;
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => Object.assign(() => model, {}),
}));

const verdict: Verdict = {
  reasoning: "Right colors, from the tool.",
  correctness: 5,
  groundedness: 5,
  safety: 5,
  tone: 3,
  passed: true,
};

const output: AskCopperOutput = {
  reply: "It comes in Polished Copper, Patina Teal and Night Sky.",
  status: "done",
  agent: "copper",
  toolCalls: [
    { name: "get_products", input: {}, output: { products: ["copper-home"] } },
  ],
  costUsd: 0.0004,
  latencyMs: 1200,
  modelCalls: 2,
  tokens: 900,
};

function replyWithJson(json: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(json) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "AIza-test-key");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("golden set", () => {
  it("has unique ids and something to check for every question", () => {
    const ids = GOLDEN_SET.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of GOLDEN_SET) {
      expect(item.question.length).toBeGreaterThan(5);
      expect(item.expected.length).toBeGreaterThan(20);
    }
  });

  it("only expects tools that exist", () => {
    for (const item of GOLDEN_SET)
      for (const tool of item.expectedTools ?? [])
        expect(Object.keys(TOOL_LABELS), item.id).toContain(tool);
  });

  it("asks refund questions on the Support page, where the Refund agent lives", () => {
    for (const item of GOLDEN_SET)
      if (item.expectedTools?.includes("request_refund"))
        expect(item.support, item.id).toBe(true);
  });

  it("covers products, docs, refunds and safety", () => {
    const categories = new Set(GOLDEN_SET.map((item) => item.category));
    for (const c of ["products", "docs", "refund", "safety", "off-topic"])
      expect(categories).toContain(c);
  });
});

describe("AI judge", () => {
  it("shows the judge the question, expectation, tools and reply", () => {
    const text = judgePrompt(
      { question: "What colors?", expected: "Three colors." },
      output,
    );
    expect(text).toContain("What colors?");
    expect(text).toContain("Three colors.");
    expect(text).toContain("get_products");
    expect(text).toContain("Polished Copper");
  });

  it("returns the judge's marks", async () => {
    model = replyWithJson(verdict);
    const result = await judgeAnswer(
      { question: "What colors?", expected: "Three colors." },
      output,
    );
    expect(result).toMatchObject({ correctness: 5, tone: 3, passed: true });
  });

  it("checks that the expected tools were called", () => {
    expect(toolCheck(["get_products"], output)).toEqual({
      ok: true,
      missing: [],
    });
    expect(toolCheck(["get_products", "search_docs"], output)).toEqual({
      ok: false,
      missing: ["search_docs"],
    });
    expect(toolCheck(undefined, output).ok).toBe(true);
  });

  it("turns marks into 0-1 Langfuse scores", () => {
    const scores = Object.fromEntries(
      scoresFor(verdict, { ok: true, missing: [] }, true).map((s) => [
        s.name,
        s,
      ]),
    );
    expect(scores.correctness.value).toBe(1);
    expect(scores.tone.value).toBe(0.5);
    expect(scores.passed).toMatchObject({ value: 1, dataType: "BOOLEAN" });
  });

  it("fails an answer the judge liked if a needed tool was skipped or it errored", () => {
    const passed = (tools: { ok: boolean; missing: string[] }, done: boolean) =>
      scoresFor(verdict, tools, done).find((s) => s.name === "passed")!.value;
    expect(passed({ ok: false, missing: ["search_docs"] }, true)).toBe(0);
    expect(passed({ ok: true, missing: [] }, false)).toBe(0);
    expect(
      scoresFor(
        { ...verdict, passed: false },
        { ok: true, missing: [] },
        true,
      ).find((s) => s.name === "passed")!.value,
    ).toBe(0);
  });
});
