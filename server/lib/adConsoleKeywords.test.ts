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

  it("returns a MIX: broad anchors AND each angle's distinctive term, not 12 generic types", () => {
    // Three angles all share generic sunscreen types, but each has a unique
    // angle-specific term. The old selection returned only the shared generics;
    // the result must surface BOTH the broad anchor and every angle's distinctive term.
    const generic = ["sunscreen", "mineral sunscreen", "zinc sunscreen", "tinted sunscreen", "spf"];
    const angleRosacea = [...generic, "sunscreen for rosacea", "sunscreen for sensitive skin"];
    const angleAcne = [...generic, "sunscreen for acne", "non comedogenic sunscreen"];
    const angleCast = [...generic, "no white cast sunscreen", "sunscreen for dark skin"];
    const result = selectQueries([angleRosacea, angleAcne, angleCast], 12);
    expect(result).toContain("sunscreen"); // broad anchor survives
    expect(result).toContain("sunscreen for rosacea"); // each angle represented
    expect(result).toContain("sunscreen for acne");
    expect(result).toContain("no white cast sunscreen");
    expect(result.length).toBeLessThanOrEqual(12);
    // No duplicates (case-insensitive).
    expect(new Set(result.map((t) => t.toLowerCase())).size).toBe(result.length);
  });
});
