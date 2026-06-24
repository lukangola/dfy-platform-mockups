import { describe, it, expect } from "vitest";
import { isTransientGenerationRefusal } from "./fal.js";

// nano-banana-pro (Gemini 3 Pro Image) intermittently 422-refuses valid,
// benign input. generateImage retries ONLY this class — so the classifier
// must catch fal's refusal phrasings while leaving real errors alone.
describe("isTransientGenerationRefusal", () => {
  it("matches the 'could not generate images' 422 (the reference-sheet flake)", () => {
    expect(
      isTransientGenerationRefusal(
        422,
        "prompt: Could not generate images with the given prompts and images. Please try again with different inputs.",
      ),
    ).toBe(true);
  });

  it("matches the 'did not generate the expected output' 422", () => {
    expect(
      isTransientGenerationRefusal(
        422,
        "The model did not generate the expected output for this prompt. This may occur for several reasons, including unsafe content...",
      ),
    ).toBe(true);
  });

  it("does NOT retry a non-422 status even with similar wording", () => {
    expect(isTransientGenerationRefusal(500, "could not generate images with the given prompts and images")).toBe(false);
    expect(isTransientGenerationRefusal(undefined, "did not generate the expected output")).toBe(false);
  });

  it("does NOT retry a 422 that is a real validation error (bad url / bad param)", () => {
    expect(isTransientGenerationRefusal(422, "image_urls.3: url could not be fetched")).toBe(false);
    expect(isTransientGenerationRefusal(422, "resolution: invalid value")).toBe(false);
  });

  it("does NOT retry auth / quota errors", () => {
    expect(isTransientGenerationRefusal(401, "Unauthorized")).toBe(false);
    expect(isTransientGenerationRefusal(429, "Too Many Requests")).toBe(false);
  });
});
