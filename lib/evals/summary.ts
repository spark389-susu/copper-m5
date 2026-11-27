import { appendFileSync } from "node:fs";

// The numbers a golden-set run is judged by: how many answers passed, what an
// answer costs and how long it takes. Shown in the terminal, in the pull
// request's check (the GitHub Actions job summary) and as scores in Langfuse.

export type Row = {
  passed: boolean;
  costUsd: number;
  latencyMs: number;
  tokens: number;
  modelCalls: number;
};

export type Summary = {
  label: string;
  answers: number;
  passed: number;
  passRate: number;
  avgCostUsd: number;
  totalCostUsd: number;
  avgLatencyS: number;
  avgTokens: number;
  avgModelCalls: number;
};

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

export function summarize(label: string, rows: Row[]): Summary {
  const passed = rows.filter((r) => r.passed).length;
  return {
    label,
    answers: rows.length,
    passed,
    passRate: rows.length ? passed / rows.length : 0,
    avgCostUsd: mean(rows.map((r) => r.costUsd)),
    totalCostUsd: rows.reduce((sum, r) => sum + r.costUsd, 0),
    avgLatencyS: mean(rows.map((r) => r.latencyMs)) / 1000,
    avgTokens: mean(rows.map((r) => r.tokens)),
    avgModelCalls: mean(rows.map((r) => r.modelCalls)),
  };
}

const usd = (n: number) => `$${n.toFixed(5)}`;

/** A markdown table with one row per run, for the job summary and the terminal. */
export function summaryTable(summaries: Summary[]): string {
  const lines = [
    "| Run | Pass rate | Avg cost / answer | Total cost | Avg speed | Avg tokens | Agent calls / answer |",
    "|---|---|---|---|---|---|---|",
    ...summaries.map(
      (s) =>
        `| ${s.label} | ${s.passed}/${s.answers} (${Math.round(s.passRate * 100)}%) | ${usd(s.avgCostUsd)} | ${usd(s.totalCostUsd)} | ${s.avgLatencyS.toFixed(1)} s | ${Math.round(s.avgTokens)} | ${s.avgModelCalls.toFixed(1)} |`,
    ),
  ];
  return lines.join("\n");
}

/**
 * Adds a section to the pull request's check page when running in GitHub
 * Actions (GITHUB_STEP_SUMMARY). Does nothing on a laptop.
 */
export function writeJobSummary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${markdown}\n`);
}
