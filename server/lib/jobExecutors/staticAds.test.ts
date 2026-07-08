import { beforeEach, describe, expect, it, vi } from "vitest";

// The executor is a thin adapter over the extracted pipeline — mock the lib
// module boundary (same idiom as broll.test.ts mocking fal.js). Mocking
// staticAdRecreate.js also keeps db/fal/prompts out of the module graph.
vi.mock("../staticAdRecreate.js", () => ({
  runStaticAdRecreate: vi.fn(),
}));

import { classifyJobError } from "../jobRunner.js";
import { runStaticAdRecreate } from "../staticAdRecreate.js";
import { runRecreateItem } from "./staticAds.js";

const mockRecreate = vi.mocked(runStaticAdRecreate);

function makeItem(input: Record<string, unknown>) {
  return {
    id: "item-1",
    jobId: "job-1",
    idx: 0,
    label: "Ref 1",
    status: "running",
    attempts: 1,
    input,
    output: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRecreate.mockReset();
});

describe("runRecreateItem", () => {
  it("returns url/referenceId/model/durationMs/promptVersion and passes item.input verbatim", async () => {
    mockRecreate.mockResolvedValueOnce({
      url: "https://i/out.jpg",
      referenceId: "ref-1",
      durationMs: 42,
      model: "fal-ai/nano-banana-pro/edit",
      promptVersion: "abc123def456",
    });
    const input = {
      referenceId: "ref-1",
      productId: "prod-1",
      angleName: "Angle A",
      language: "de",
      brand: { name: "Acme" },
      feedback: "less clutter",
      previousOutputUrl: "https://i/prev.jpg",
      pipelineCardId: "card-1",
    };

    const result = await runRecreateItem({ item: makeItem(input), payload: {} });

    expect(result).toEqual({
      url: "https://i/out.jpg",
      referenceId: "ref-1",
      durationMs: 42,
      model: "fal-ai/nano-banana-pro/edit",
      promptVersion: "abc123def456",
    });
    expect(mockRecreate).toHaveBeenCalledTimes(1);
    // Verbatim: the exact same object reference, no re-shaping.
    expect(mockRecreate.mock.calls[0][0]).toBe(input);
  });

  it("propagates thrown errors unchanged so the runner classifies them", async () => {
    const err = Object.assign(
      new Error(
        "The image model's content-safety filter blocked this reference + product combo. This is deterministic — retrying will hit the same block. Pick a different reference ad for this angle.",
      ),
      { status: 422 },
    );
    mockRecreate.mockRejectedValueOnce(err);

    await expect(
      runRecreateItem({ item: makeItem({ referenceId: "ref-1", productId: "p", angleName: "a" }), payload: {} }),
    ).rejects.toBe(err);
    expect(mockRecreate).toHaveBeenCalledTimes(1);
  });

  it("classified content-safety message lands as 'hard' in the runner (no likeness/transient match)", () => {
    // Pins the interaction between the route's friendly moderation text and
    // classifyJobError: even with the provider's original 422 preserved on
    // `.status`, the message matches neither the likeness regex nor the
    // transient regex → hard fail, no retry (moderation is deterministic).
    // And even IF it ever classified as likeness, the Kling fallback lives
    // only in the b-roll VIDEO executor — no cross-effect for images.
    const moderationMessage =
      "The image model's content-safety filter blocked this reference + product combo. This is deterministic — retrying will hit the same block. Pick a different reference ad for this angle.";
    expect(classifyJobError(422, moderationMessage)).toBe("hard");
    expect(classifyJobError(undefined, moderationMessage)).toBe("hard");
  });
});
