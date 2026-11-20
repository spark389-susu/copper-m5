import { describe, expect, it } from "vitest";
import { expectedToolsFor, SETUPS } from "@/lib/evals/compare";

describe("single agent vs two agents", () => {
  it("compares both setups", () => {
    expect(SETUPS.map((s) => s.id)).toEqual(["two-agents", "single"]);
  });

  it("keeps every expected tool for the two agents", () => {
    expect(
      expectedToolsFor("two-agents", [
        "transfer_to_refund_agent",
        "request_refund",
      ]),
    ).toEqual(["transfer_to_refund_agent", "request_refund"]);
  });

  it("drops handoff tools for the single agent", () => {
    expect(
      expectedToolsFor("single", [
        "transfer_to_refund_agent",
        "request_refund",
      ]),
    ).toEqual(["request_refund"]);
    expect(expectedToolsFor("single", undefined)).toBeUndefined();
  });
});
