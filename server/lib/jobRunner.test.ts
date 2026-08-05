import { describe, it, expect } from "vitest";
import { classifyJobError, seedanceToKlingFallback, stripSeedanceImageMarkers } from "./jobRunner.js";

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
  it("does NOT treat Kling's input_value_error as a likeness refusal", () => {
    // "Invalid reference index N … Only 0 images provided." is KLING rejecting a
    // prompt that still carries Seedance @ImageN markers — our own mapping bug.
    // Misreading it as a content refusal would hide the real failure.
    expect(
      classifyJobError(422, "Unprocessable Entity — Invalid reference index 1 for image. Only 0 images provided."),
    ).toBe("hard");
  });
  it("marks fal's structured content-policy fields as likeness", () => {
    expect(classifyJobError(422, "content_policy_violation")).toBe("likeness");
    expect(classifyJobError(422, "partner_validation_failed")).toBe("likeness");
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
      // @Image1 is rewritten: Kling parses the marker and 422s on it. This
      // expectation previously asserted the marker passed through verbatim,
      // which is precisely the bug that killed Puzzle Makeup's 12 clips.
      prompt: "Slide the mailer open the image",
      image_url: "https://img/start.jpg",
      duration: "5",
      aspect_ratio: "9:16",
    });
  });
  it("returns null when there is no starting frame", () => {
    expect(seedanceToKlingFallback({ prompt: "x", image_urls: [] })).toBeNull();
  });
});

describe("stripSeedanceImageMarkers", () => {
  it("rewrites @ImageN markers into prose (Kling 422s on them)", () => {
    const out = stripSeedanceImageMarkers(
      "Animate @Image1. Preserve the product shown in @Image2 — label and cap. Hand count matches @Image1 exactly.",
    );
    expect(out).not.toMatch(/@Image/i);
    expect(out).toBe("Animate the image. Preserve the product shown in the image — label and cap. Hand count matches the image exactly.");
  });
  it("tolerates spacing/casing variants", () => {
    expect(stripSeedanceImageMarkers("@image 1 and @IMAGE2")).toBe("the image and the image");
  });
  it("leaves a marker-free prompt untouched", () => {
    const p = "A calm pan across the counter.";
    expect(stripSeedanceImageMarkers(p)).toBe(p);
  });
});

describe("seedanceToKlingFallback prompt sanitisation", () => {
  it("never sends @ImageN through to Kling", () => {
    const fb = seedanceToKlingFallback({
      prompt: "Animate @Image1. Match @Image2 exactly.",
      image_urls: ["https://x/a.jpg", "https://x/b.jpg"],
      duration: "5",
    });
    expect(fb).not.toBeNull();
    expect(String(fb!.input.prompt)).not.toMatch(/@Image/i);
    expect(fb!.input.image_url).toBe("https://x/a.jpg");
  });
});
