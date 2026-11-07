import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { subscribe, cancel } = vi.hoisted(() => ({ subscribe: vi.fn(), cancel: vi.fn() }));
vi.mock("@fal-ai/client", () => ({
  fal: { config: vi.fn(), subscribe, queue: { cancel }, storage: { upload: vi.fn() } },
}));
vi.mock("./env.js", () => ({ env: { FAL_KEY: "test-key", FAL_VIDEO_TIMEOUT_MS: 1000 }, isDev: true }));

import { generateVideo, FalTimeoutError } from "./fal.js";

const MODEL = "fal-ai/kling-video/v3/standard/image-to-video";

// fal's client-side `timeout` is documented as not enforced; a request stuck
// in fal's queue once blocked a B-roll job item for 82 minutes. generateVideo
// must give up on its own, cancel the queued request and fail transiently
// (status >= 500 + "timeout" in the message) so the job runner retries.
describe("generateVideo wall-clock timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    subscribe.mockReset();
    cancel.mockReset();
    cancel.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fails transiently and cancels the queued request when fal never answers", async () => {
    subscribe.mockImplementation((_model: string, opts: { onEnqueue?: (id: string) => void }) => {
      opts.onEnqueue?.("req-1");
      return new Promise(() => {});
    });
    const pending = generateVideo({ model: MODEL, input: {} });
    const assertion = expect(pending).rejects.toMatchObject({
      name: "FalTimeoutError",
      status: 504,
      message: expect.stringMatching(/timeout after 1s/),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(cancel).toHaveBeenCalledWith(MODEL, { requestId: "req-1" });
  });

  it("honours a per-call timeoutMs over the env default", async () => {
    subscribe.mockImplementation(() => new Promise(() => {}));
    const pending = generateVideo({ model: MODEL, input: {}, timeoutMs: 5000 });
    const assertion = expect(pending).rejects.toBeInstanceOf(FalTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    expect(cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4000);
    await assertion;
  });

  it("returns the video and clears the timer when fal answers in time", async () => {
    subscribe.mockResolvedValue({ data: { video: { url: "https://fal.media/v.mp4" } } });
    const result = await generateVideo({ model: MODEL, input: {} });
    expect(result.urls).toEqual(["https://fal.media/v.mp4"]);
    expect(result.model).toBe(MODEL);
    expect(vi.getTimerCount()).toBe(0);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("still wraps ordinary fal rejections with their status", async () => {
    subscribe.mockRejectedValue({ status: 500, body: { detail: "Internal Server Error" } });
    await expect(generateVideo({ model: MODEL, input: {} })).rejects.toMatchObject({
      status: 500,
      message: expect.stringMatching(/Internal Server Error/),
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
