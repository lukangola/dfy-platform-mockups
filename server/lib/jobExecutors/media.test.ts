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

vi.mock("../fal.js", () => ({
  generateImage: vi.fn(),
  generateVideo: vi.fn(),
}));

import { db } from "../db.js";
import { generateImage, generateVideo } from "../fal.js";
import { makeImageExecutor, makeVideoExecutor, runImageItem, runVideoItem } from "./media.js";

const mockGenerateImage = vi.mocked(generateImage);
const mockGenerateVideo = vi.mocked(generateVideo);

const SEEDANCE = "bytedance/seedance-2.0/fast/reference-to-video";
const KLING = "fal-ai/kling-video/v3/standard/image-to-video";

const likenessError = () =>
  Object.assign(
    new Error(
      "image_urls: The images or videos provided may contain likenesses of real people or other private information that cannot be processed.",
    ),
    { status: 422 },
  );

function makeItem(falInput: Record<string, unknown>, model?: string) {
  return {
    id: "item-1",
    jobId: "job-1",
    idx: 0,
    label: "Shot 1",
    status: "running",
    attempts: 1,
    input: { shotId: "shot-1", kind: "video", model, falInput },
    output: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateImage.mockReset();
  mockGenerateVideo.mockReset();
});

describe("runVideoItem", () => {
  it("renders on KLING directly — seedance is never called", async () => {
    mockGenerateVideo.mockResolvedValueOnce({ urls: ["https://v/ok.mp4"], raw: {}, model: KLING, durationMs: 5 });

    const result = await runVideoItem({
      item: makeItem({
        prompt: "Animate @Image1 preserving @Image2.",
        image_urls: ["https://start.jpg", "https://product.jpg"],
      }),
      payload: {},
    });

    expect(result.url).toBe("https://v/ok.mp4");
    expect(result.generationId).toBe("gen-1");
    // ONE call, straight to Kling — no Seedance attempt, no refusal tax.
    expect(mockGenerateVideo).toHaveBeenCalledTimes(1);
    const call = mockGenerateVideo.mock.calls[0][0];
    expect(call.model).toBe(KLING);
    expect(call.model).not.toBe(SEEDANCE);
    const klingInput = call.input as Record<string, unknown>;
    // The stored payload is still Seedance-shaped (image_urls/@ImageN); the
    // executor adapts it so pre-switch jobs run on Kling too.
    expect(klingInput.start_image_url).toBe("https://start.jpg");
    expect(klingInput.elements).toEqual([
      { reference_image_urls: ["https://product.jpg"], frontal_image_url: "https://product.jpg" },
    ]);
    expect(String(klingInput.prompt)).not.toMatch(/@Image/i);
    expect(String(klingInput.prompt)).toContain("@Element1");
  });

  it("does not re-issue a second call on a content refusal (no provider left to try)", async () => {
    // Kling IS the primary now; retrying the identical call would just buy a
    // second refusal at full price.
    const err = likenessError();
    mockGenerateVideo.mockRejectedValueOnce(err);

    await expect(
      runVideoItem({
        item: makeItem({ prompt: "Animate @Image1.", image_urls: ["https://start.jpg"] }),
        payload: {},
      }),
    ).rejects.toBe(err);
    expect(mockGenerateVideo).toHaveBeenCalledTimes(1);
  });

  it("rethrows transient errors so the runner retries them", async () => {
    mockGenerateVideo.mockRejectedValueOnce(
      Object.assign(new Error("Gateway Timeout - Downstream service unavailable"), { status: 502 }),
    );

    await expect(
      runVideoItem({ item: makeItem({ prompt: "x", image_urls: ["https://start.jpg"] }), payload: {} }),
    ).rejects.toThrow(/Gateway Timeout/);
    expect(mockGenerateVideo).toHaveBeenCalledTimes(1);
  });

  it("leaves a payload with no image_urls on its declared model", async () => {
    // Nothing to map → primary stays whatever the item declared.
    mockGenerateVideo.mockResolvedValueOnce({ urls: ["https://v/ok.mp4"], raw: {}, model: SEEDANCE, durationMs: 5 });
    await runVideoItem({ item: makeItem({ prompt: "x" }), payload: {} });
    expect(mockGenerateVideo.mock.calls[0][0].model).toBe(SEEDANCE);
  });
});

describe("executor factories", () => {
  it("makeImageExecutor logs a generations row with the given per-app action", async () => {
    mockGenerateImage.mockResolvedValueOnce({
      urls: ["https://i/char.jpg"],
      raw: {},
      model: "fal-ai/nano-banana-pro/edit",
      durationMs: 4,
    });

    const exec = makeImageExecutor("character_broll_image");
    const result = await exec({ item: makeItem({ prompt: "hero shot" }), payload: {} });

    expect(result.url).toBe("https://i/char.jpg");
    expect(result.generationId).toBe("gen-1");
    const insertMock = db.insert as unknown as ReturnType<typeof vi.fn>;
    const valuesMock = insertMock.mock.results[0]?.value.values as ReturnType<typeof vi.fn>;
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "character_broll_image", kind: "image" }),
    );
  });

  it("makeVideoExecutor with seedanceKlingFallback:false does NOT retry a likeness 422", async () => {
    const err = likenessError();
    mockGenerateVideo.mockRejectedValueOnce(err);

    const exec = makeVideoExecutor("character_broll_video", { seedanceKlingFallback: false });
    await expect(
      // Starting frame present — a fallback WOULD be possible, proving the
      // flag (not a missing frame) is what suppresses the second call.
      exec({ item: makeItem({ prompt: "x", image_urls: ["https://start.jpg"] }, KLING), payload: {} }),
    ).rejects.toBe(err);
    expect(mockGenerateVideo).toHaveBeenCalledTimes(1);
  });
});

describe("runImageItem", () => {
  it("returns url/model/durationMs/generationId on success", async () => {
    mockGenerateImage.mockResolvedValueOnce({
      urls: ["https://i/ok.jpg"],
      raw: {},
      model: "fal-ai/nano-banana-pro/edit",
      durationMs: 3,
    });

    const result = await runImageItem({
      item: makeItem({ prompt: "product on desk" }),
      payload: {},
    });

    expect(result).toEqual({
      url: "https://i/ok.jpg",
      model: "fal-ai/nano-banana-pro/edit",
      durationMs: 3,
      generationId: "gen-1",
    });
  });
});
