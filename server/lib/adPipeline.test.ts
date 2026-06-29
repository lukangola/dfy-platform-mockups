import { describe, it, expect } from "vitest";
import { resolveCardOutput, canEnterReady, pickVideoUrl } from "./adPipeline.js";

describe("resolveCardOutput", () => {
  it("prefers the saved asset over a generation (text/video card)", () => {
    const out = resolveCardOutput(
      "video",
      { id: "a1", url: "document:rewrite", metadata: { content: "REWRITTEN" }, createdAt: "2026-06-18T00:00:00Z" },
      { output: { text: "DRAFT" }, createdAt: "2026-06-17T00:00:00Z" },
    );
    expect(out).toEqual({
      source: "asset", kind: "text", text: "REWRITTEN", imageUrl: null,
      savedAssetId: "a1", generatedAt: "2026-06-18T00:00:00Z",
    });
  });

  it("falls back to the latest generation when no asset is saved (text)", () => {
    const out = resolveCardOutput("video", null, { output: { text: "DRAFT" }, createdAt: "2026-06-17T00:00:00Z" });
    expect(out).toEqual({
      source: "generation", kind: "text", text: "DRAFT", imageUrl: null,
      savedAssetId: null, generatedAt: "2026-06-17T00:00:00Z",
    });
  });

  it("reads the image url for a static card from a saved asset", () => {
    const out = resolveCardOutput(
      "static",
      { id: "a2", url: "https://cdn/out.png", metadata: {}, createdAt: "2026-06-18T00:00:00Z" },
      null,
    );
    expect(out).toEqual({
      source: "asset", kind: "image", text: null, imageUrl: "https://cdn/out.png",
      savedAssetId: "a2", generatedAt: "2026-06-18T00:00:00Z",
    });
  });

  it("reads the image url for a static card from a generation output", () => {
    const out = resolveCardOutput("static", null, { output: { url: "https://cdn/g.png" }, createdAt: "2026-06-17T00:00:00Z" });
    expect(out?.imageUrl).toBe("https://cdn/g.png");
    expect(out?.source).toBe("generation");
  });

  it("returns null when there is no asset and no generation", () => {
    expect(resolveCardOutput("video", null, null)).toBeNull();
  });
});

describe("canEnterReady", () => {
  it("requires a saved brand asset", () => {
    expect(canEnterReady(true)).toBe(true);
    expect(canEnterReady(false)).toBe(false);
  });
});

describe("pickVideoUrl", () => {
  it("picks the first video-extension url", () => {
    expect(pickVideoUrl(["https://x/cover.jpg", "https://x/clip.mp4"])).toBe("https://x/clip.mp4");
  });
  it("falls back to the first url when none look like video", () => {
    expect(pickVideoUrl(["https://x/a", "https://x/b"])).toBe("https://x/a");
  });
  it("returns null for an empty list", () => {
    expect(pickVideoUrl([])).toBeNull();
  });
});
