import { describe, it, expect } from "vitest";
import { enrichmentPlan } from "./adPipelineEnrich.js";

describe("enrichmentPlan", () => {
  it("uses an existing transcript for a video card without transcribing", () => {
    const plan = enrichmentPlan({
      format: "video", transcript: "already here", referenceMediaUrls: ["https://x/clip.mp4"],
    });
    expect(plan).toEqual({ kind: "use_existing_transcript", transcript: "already here" });
  });

  it("transcribes a video card that has no transcript", () => {
    const plan = enrichmentPlan({
      format: "video", transcript: null, referenceMediaUrls: ["https://x/cover.jpg", "https://x/clip.mp4"],
    });
    expect(plan).toEqual({ kind: "transcribe", audioUrl: "https://x/clip.mp4" });
  });

  it("deconstructs a static card from its first media url", () => {
    const plan = enrichmentPlan({
      format: "static", transcript: null, referenceMediaUrls: ["https://x/ad.png"],
    });
    expect(plan).toEqual({ kind: "deconstruct", imageUrl: "https://x/ad.png" });
  });

  it("returns a noop when a video card has neither transcript nor media", () => {
    expect(enrichmentPlan({ format: "video", transcript: null, referenceMediaUrls: [] }))
      .toEqual({ kind: "noop" });
  });
});
