import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordCall, trackUsage } from "@/lib/ai/usage";
import { summarize, summaryTable, writeJobSummary } from "@/lib/evals/summary";

afterEach(() => vi.unstubAllEnvs());

const row = (passed: boolean, costUsd: number, latencyMs: number) => ({
  passed,
  costUsd,
  latencyMs,
  tokens: 1000,
  modelCalls: 2,
});

describe("summarize", () => {
  it("works out pass rate, cost and speed", () => {
    const s = summarize("run", [
      row(true, 0.002, 2000),
      row(false, 0.004, 4000),
    ]);
    expect(s).toMatchObject({
      answers: 2,
      passed: 1,
      passRate: 0.5,
      totalCostUsd: 0.006,
      avgLatencyS: 3,
    });
    expect(s.avgCostUsd).toBeCloseTo(0.003);
  });

  it("handles an empty run", () => {
    expect(summarize("empty", []).passRate).toBe(0);
  });

  it("makes a table with one row per run", () => {
    const table = summaryTable([
      summarize("two agents", [row(true, 0.002, 2000)]),
      summarize("single agent", [row(true, 0.001, 1000)]),
    ]);
    expect(table).toContain("| two agents | 1/1 (100%) | $0.00200 |");
    expect(table).toContain("| single agent | 1/1 (100%) | $0.00100 |");
  });
});

describe("writeJobSummary", () => {
  it("writes to the GitHub Actions summary file when set", () => {
    const file = join(mkdtempSync(join(tmpdir(), "summary-")), "out.md");
    vi.stubEnv("GITHUB_STEP_SUMMARY", file);
    writeJobSummary("## hello");
    expect(readFileSync(file, "utf8")).toBe("## hello\n");
  });

  it("does nothing outside GitHub Actions", () => {
    vi.stubEnv("GITHUB_STEP_SUMMARY", "");
    expect(() => writeJobSummary("x")).not.toThrow();
  });
});

describe("trackUsage", () => {
  const call = { cost_usd: 0.1 } as never;

  it("collects the calls made while it runs", async () => {
    const { result, calls } = await trackUsage(async () => {
      recordCall(call);
      await Promise.resolve();
      recordCall(call);
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("collects nothing outside it", () => {
    expect(() => recordCall(call)).not.toThrow();
  });
});
