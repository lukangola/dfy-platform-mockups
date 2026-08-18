import { describe, it, expect } from "vitest";
import { applyUsableReferences, classifyJobError, seedanceToKlingFallback, stripSeedanceImageMarkers } from "./jobRunner.js";

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
  it("maps seedance refs onto kling start_image_url + elements/@Element1", () => {
    const out = seedanceToKlingFallback({
      prompt: "Slide the mailer open @Image1. Preserve the product in @Image2 exactly.",
      image_urls: ["https://img/start.jpg", "https://img/ref.jpg", "https://img/ref2.jpg"],
      duration: "5",
      aspect_ratio: "9:16",
      resolution: "720p",
      generate_audio: false,
    });
    expect(out?.model).toBe("fal-ai/kling-video/v3/standard/image-to-video");
    expect(out?.input).toEqual({
      // @Image1 -> prose (kling has no start-frame marker);
      // @Image2 -> @Element1, which the elements bundle resolves.
      prompt: "Slide the mailer open the starting frame. Preserve the product in @Element1 exactly.",
      start_image_url: "https://img/start.jpg",
      duration: "5",
      aspect_ratio: "9:16",
      generate_audio: false,
      elements: [{
        reference_image_urls: ["https://img/ref.jpg", "https://img/ref2.jpg"],
        frontal_image_url: "https://img/ref.jpg",
      }],
    });
  });
  it("carries EVERY extra reference through — losing them costs product fidelity", () => {
    const out = seedanceToKlingFallback({
      prompt: "Animate @Image1 matching @Image2.",
      image_urls: ["https://img/a.jpg", "https://img/b.jpg", "https://img/c.jpg", "https://img/d.jpg"],
    });
    const els = (out!.input.elements as Array<{ reference_image_urls: string[] }>)[0];
    expect(els.reference_image_urls).toHaveLength(3);
  });
  it("emits NO @Element1 when there is nothing to bind it to", () => {
    // A dangling @Element1 would 422 exactly like the @Image1 bug did.
    const out = seedanceToKlingFallback({
      prompt: "Animate @Image1. Match @Image2 exactly.",
      image_urls: ["https://img/only.jpg"],
    });
    expect(String(out!.input.prompt)).not.toMatch(/@Element/i);
    expect(String(out!.input.prompt)).not.toMatch(/@Image/i);
    expect(out!.input.elements).toBeUndefined();
  });
  it("returns null when there is no starting frame", () => {
    expect(seedanceToKlingFallback({ prompt: "x", image_urls: [] })).toBeNull();
  });
});

describe("stripSeedanceImageMarkers", () => {
  it("maps @Image1 to prose and @Image2+ to @Element1 when elements are attached", () => {
    const out = stripSeedanceImageMarkers(
      "Animate @Image1. Preserve the product shown in @Image2 — label and cap. Hand count matches @Image1 exactly.",
      true,
    );
    expect(out).not.toMatch(/@Image/i);
    expect(out).toBe("Animate the starting frame. Preserve the product shown in @Element1 — label and cap. Hand count matches the starting frame exactly.");
  });
  it("degrades @Image2+ to prose when there are no elements", () => {
    const out = stripSeedanceImageMarkers("Animate @Image1 matching @Image2.", false);
    expect(out).toBe("Animate the starting frame matching the product.");
    expect(out).not.toMatch(/@/);
  });
  it("tolerates spacing/casing variants and does not mangle @Image10", () => {
    expect(stripSeedanceImageMarkers("@image 1 and @IMAGE2", true)).toBe("the starting frame and @Element1");
    expect(stripSeedanceImageMarkers("@Image10", true)).toBe("@Element1");
  });
  it("leaves a marker-free prompt untouched", () => {
    const p = "A calm pan across the counter.";
    expect(stripSeedanceImageMarkers(p, true)).toBe(p);
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
    expect(fb!.input.start_image_url).toBe("https://x/a.jpg");
  });
});

describe("applyUsableReferences", () => {
  const BIG = "https://x/sheet.jpg";      // 1536x2752 generated reference sheet
  const TINY = "https://x/thumb.png";     // 124x168 scraped thumbnail
  const base = () => ({
    prompt: "Animate the starting frame. Preserve @Element1 exactly.",
    start_image_url: "https://x/frame.jpg",
    elements: [{ reference_image_urls: [TINY, BIG], frontal_image_url: TINY }],
  });

  it("drops the undersized ref and re-points frontal at a survivor", () => {
    // Primal Science: frontal was the 124x168 thumb, which is the field Kling
    // named in the 422. The generated sheet in the same bundle was fine.
    const out = applyUsableReferences(base(), new Set([BIG]));
    const el = (out.elements as Array<Record<string, unknown>>)[0];
    expect(el.reference_image_urls).toEqual([BIG]);
    expect(el.frontal_image_url).toBe(BIG);
    expect(String(out.prompt)).toContain("@Element1"); // bundle survives → marker stays
  });

  it("keeps frontal untouched when it is itself usable", () => {
    const out = applyUsableReferences(base(), new Set([TINY, BIG]));
    expect(out).toEqual(base()); // nothing dropped → identical payload
  });

  it("removes the bundle AND the @Element1 marker when nothing survives", () => {
    // A marker with no bundle behind it is the dangling-reference 422 all over
    // again — worse than the undersized image it replaced.
    const out = applyUsableReferences(base(), new Set());
    expect(out.elements).toBeUndefined();
    expect(String(out.prompt)).not.toMatch(/@Element/i);
    expect(String(out.prompt)).toContain("the product");
  });

  it("is a no-op for payloads with no elements bundle", () => {
    const input = { prompt: "x", start_image_url: "https://x/f.jpg" };
    expect(applyUsableReferences(input, new Set())).toBe(input);
  });
});
