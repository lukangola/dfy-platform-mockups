import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => {
  const returning = vi.fn().mockResolvedValue([{ id: "gen-1" }]);
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));
  return {
    db: { insert },
    schema: { generations: { id: "generations.id" } },
  };
});

vi.mock("../anthropic.js", () => ({
  generateText: vi.fn(),
}));

vi.mock("../prompts.js", () => ({
  loadPrompt: vi.fn(),
}));

import { generateText } from "../anthropic.js";
import { db } from "../db.js";
import { loadPrompt } from "../prompts.js";
import { runCopyEngineTextItem } from "./copyEngine.js";

const mockGenerateText = vi.mocked(generateText);
const mockLoadPrompt = vi.mocked(loadPrompt);

const TEXT_RESULT = {
  text: "# The 11 Reasons…",
  model: "claude-opus-4-7",
  tokensIn: 1200,
  tokensOut: 6400,
  costUsd: 0.166,
  durationMs: 91_000,
  stopReason: "end_turn",
};

function makeItem(input: Record<string, unknown>) {
  return {
    id: "item-1",
    jobId: "job-1",
    idx: 0,
    label: "Copy — Listicle · Product X",
    status: "running",
    attempts: 1,
    input,
    output: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}

function insertedValues(): Record<string, unknown> {
  const insertMock = db.insert as unknown as ReturnType<typeof vi.fn>;
  const valuesMock = insertMock.mock.results[0]?.value.values as ReturnType<typeof vi.fn>;
  return valuesMock.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateText.mockReset();
  mockLoadPrompt.mockReset();
  mockLoadPrompt.mockReturnValue({
    rendered: "SYSTEM PROMPT (rendered)",
    raw: "raw",
    version: "v-abc123",
    config: { model: "claude-opus-4-7", maxTokens: 12_000 },
  });
});

describe("runCopyEngineTextItem", () => {
  it("happy path: calls generateText with the route's exact shape, logs a text generations row, returns text + accounting", async () => {
    mockGenerateText.mockResolvedValueOnce(TEXT_RESULT);
    const vars = { product: "Product X", angle: "Angle 1", offer: "58% off" };

    const result = await runCopyEngineTextItem({
      item: makeItem({ action: "listicle_copy", vars, maxTokens: 8000 }),
      payload: {},
    });

    expect(result).toEqual({
      text: "# The 11 Reasons…",
      model: "claude-opus-4-7",
      tokensIn: 1200,
      tokensOut: 6400,
      costUsd: 0.166,
      durationMs: 91_000,
      generationId: "gen-1",
    });

    // Same server-side pieces + precedence as POST /api/generate/text/:action.
    expect(mockLoadPrompt).toHaveBeenCalledWith("listicle_copy", vars);
    expect(mockGenerateText).toHaveBeenCalledWith({
      systemPrompt: "SYSTEM PROMPT (rendered)",
      userMessage: `Inputs (JSON):\n${JSON.stringify(vars, null, 2)}`,
      model: "claude-opus-4-7",
      maxTokens: 8000, // item override beats prompt.config.maxTokens
      tools: undefined,
    });

    expect(insertedValues()).toEqual(
      expect.objectContaining({
        action: "listicle_copy",
        kind: "text",
        output: { text: "# The 11 Reasons…" },
        model: "claude-opus-4-7",
        promptVersion: "v-abc123",
        tokensIn: 1200,
        tokensOut: 6400,
        costUsd: "0.166",
        durationMs: 91_000,
      }),
    );
  });

  it("logs pipelineCardId TOP-LEVEL in inputs so the Ad Pipeline draft lookup keeps working", async () => {
    mockGenerateText.mockResolvedValueOnce(TEXT_RESULT);

    await runCopyEngineTextItem({
      item: makeItem({ action: "copy_rewrite", vars: { source_copy: "old" }, pipelineCardId: "card-9" }),
      payload: {},
    });

    expect(insertedValues().inputs).toEqual(
      expect.objectContaining({ source_copy: "old", pipelineCardId: "card-9", jobItemId: "item-1" }),
    );
  });

  it("rejects actions outside the Copy Engine allowlist without touching the prompt loader or Claude", async () => {
    await expect(
      runCopyEngineTextItem({
        item: makeItem({ action: "resonance_mining", vars: {} }),
        payload: {},
      }),
    ).rejects.toThrow(/not an allowed Copy Engine action/);
    expect(mockLoadPrompt).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("propagates generateText errors as-is (status intact for the runner's transient classification) and logs nothing", async () => {
    const err = Object.assign(new Error("Internal server error"), { status: 500 });
    mockGenerateText.mockRejectedValueOnce(err);

    await expect(
      runCopyEngineTextItem({
        item: makeItem({ action: "mini_vsl_copy", vars: { product: "X" } }),
        payload: {},
      }),
    ).rejects.toBe(err);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
