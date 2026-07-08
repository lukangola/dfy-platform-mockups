import { describe, it, expect } from "vitest";
import { classifyJobError, seedanceToKlingFallback } from "./jobRunner.js";

describe("classifyJobError", () => {
  it("marks 5xx / gateway / timeout / 429 as transient", () => {
    expect(classifyJobError(502, "Bad Gateway")).toBe("transient");
    expect(classifyJobError(undefined, "Gateway Timeout - Downstream service unavailable")).toBe("transient");
    expect(classifyJobError(429, "Too Many Requests")).toBe("transient");
    expect(classifyJobError(undefined, "fetch failed")).toBe("transient");
  });
  it("marks Seedance likeness/content-checker 422s as likeness", () => {
    expect(classifyJobError(422, "image_urls: The images or videos provided may contain likenesses of real people or other private information that cannot be processed.")).toBe("likeness");
    expect(classifyJobError(422, "prompt: The content could not be processed because it contained material flagged by a content checker.")).toBe("likeness");
  });
  it("marks other 4xx as hard", () => {
    expect(classifyJobError(422, "resolution: invalid value")).toBe("hard");
    expect(classifyJobError(400, "prompt required")).toBe("hard");
  });
  it("falls back to hard when neither status nor message match anything", () => {
    expect(classifyJobError(undefined, "some unrelated string")).toBe("hard");
  });
});

describe("seedanceToKlingFallback", () => {
  it("maps seedance reference-to-video input to kling image-to-video", () => {
    const out = seedanceToKlingFallback({
      prompt: "Slide the mailer open @Image1",
      image_urls: ["https://img/start.jpg", "https://img/ref.jpg"],
      duration: "5",
      aspect_ratio: "9:16",
      resolution: "720p",
      generate_audio: false,
    });
    expect(out?.model).toBe("fal-ai/kling-video/v3/standard/image-to-video");
    expect(out?.input).toEqual({
      prompt: "Slide the mailer open @Image1",
      image_url: "https://img/start.jpg",
      duration: "5",
      aspect_ratio: "9:16",
    });
  });
  it("returns null when there is no starting frame", () => {
    expect(seedanceToKlingFallback({ prompt: "x", image_urls: [] })).toBeNull();
  });
});
