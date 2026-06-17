import { describe, it, expect } from "vitest";
import { selectQueries } from "./adConsoleKeywords.js";

describe("selectQueries", () => {
  it("surfaces shared one-word category anchors despite the cap", () => {
    // Each angle shares the one-word anchors "sunscreen"/"spf" plus many two-word
    // phrases. The old impl front-loaded phrases and sliced to 12, dropping the
    // anchors — the exact bug where "sunscreen" was in the data but never searched.
    const phrasesA = [
      "mineral sunscreen", "zinc sunscreen", "tinted sunscreen", "daily sunscreen",
      "face sunscreen", "clean sunscreen", "reef safe", "broad spectrum",
      "non greasy", "lightweight cream", "pore blurring", "satin finish", "spf moisturizer",
    ];
    const phrasesB = [
      "korean sunscreen", "japanese sunscreen", "gel sunscreen", "spray sunscreen",
      "kids sunscreen", "sport sunscreen", "matte sunscreen", "hydrating spf",
      "invisible spf", "no white cast", "glowy sunscreen", "everyday spf", "spf primer",
    ];
    const angleA = ["sunscreen", "spf", ...phrasesA];
    const angleB = ["sunscreen", "spf", ...phrasesB];
    const result = selectQueries([angleA, angleB], 12);
    expect(result).toContain("sunscreen");
    expect(result).toContain("spf");
    expect(result).toHaveLength(12);
  });

  it("dedupes case-insensitively and respects the limit", () => {
    const result = selectQueries([["Sunscreen", "sunscreen", "mineral sunscreen"]], 12);
    expect(result.filter((t) => t.toLowerCase() === "sunscreen")).toHaveLength(1);
    expect(result.length).toBeLessThanOrEqual(12);
  });
});
