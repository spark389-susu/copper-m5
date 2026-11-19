// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createLive } from "@/lib/ai/live";
import type { Progress } from "@/lib/copper/assistant/progress";

const asked = vi.fn();
vi.mock("@/lib/copper/assistant/ask", () => ({
  askCopper: (request: unknown) => asked(request),
}));

describe("runAskCopper", () => {
  it("waits for the whole answer and reports the reply and tools", async () => {
    const { live, update, done } = createLive<Progress>();
    asked.mockResolvedValue({ progress: live });
    const { runAskCopper } = await import("@/lib/evals/run-ask-copper");

    const pending = runAskCopper({ question: "Refund #1001", support: true });
    update({ steps: [], reply: "Working", status: "working" });
    done({
      steps: [
        {
          type: "tool",
          id: "0:a",
          name: "request_refund",
          state: "done",
          input: { orderId: "1001" },
          output: { status: "refunded" },
        },
      ],
      reply: "Refunded $7.99.",
      status: "done",
      agent: "refund",
    });

    expect(await pending).toEqual({
      reply: "Refunded $7.99.",
      status: "done",
      agent: "refund",
      toolCalls: [
        {
          name: "request_refund",
          input: { orderId: "1001" },
          output: { status: "refunded" },
        },
      ],
    });
    expect(asked).toHaveBeenCalledWith(
      expect.objectContaining({
        useTools: true,
        desk: { limitUsd: 50, refunds: [] },
      }),
    );
  });
});
