import { describe, it, expect } from "vitest";
import { formatError } from "./formatError.js";

describe("formatError", () => {
  it("unwraps a plain Error's message", () => {
    expect(formatError(new Error("boom"))).toBe("boom");
  });

  it("prefixes HTTP status for a fal string body", () => {
    expect(formatError({ status: 500, body: "upstream exploded" })).toBe("HTTP 500: upstream exploded");
  });

  it("reads a string body.detail", () => {
    expect(formatError({ status: 422, body: { detail: "Image is unsafe" } })).toBe("HTTP 422: Image is unsafe");
  });

  // The regression this fix targets: fal validation errors arrive as a
  // `detail[]` array. Previously this fell through to the generic status
  // text ("Unprocessable Entity") and the real field-level reason was lost.
  it("flattens a fal validation detail[] array into loc: msg", () => {
    const err = {
      status: 422,
      body: {
        detail: [
          {
            loc: ["body", "prompt"],
            msg: "Could not generate images with the given prompts and images.",
            type: "invalid_request",
          },
        ],
      },
    };
    expect(formatError(err)).toBe(
      "HTTP 422: prompt: Could not generate images with the given prompts and images.",
    );
  });

  it("joins multiple detail[] entries with a separator", () => {
    const err = {
      status: 422,
      body: {
        detail: [
          { loc: ["body", "image_urls", 3], msg: "url could not be fetched", type: "value_error" },
          { loc: ["body", "resolution"], msg: "invalid value", type: "enum" },
        ],
      },
    };
    expect(formatError(err)).toBe(
      "HTTP 422: image_urls.3: url could not be fetched | resolution: invalid value",
    );
  });

  it("never renders [object Object] for an opaque object", () => {
    const out = formatError({ weird: true });
    expect(out).not.toContain("[object Object]");
  });
});
