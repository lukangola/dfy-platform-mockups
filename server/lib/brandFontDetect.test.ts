import { describe, it, expect } from "vitest";
import { formatDetectedFontsForPrompt, type FontDetectionResult } from "./brandFontDetect.js";

/**
 * The network-facing half (detectSiteFonts) is exercised against live sites
 * manually; these cover the pure formatting/evidence contract the prompt
 * depends on, plus the specific mis-detections that made this module
 * necessary.
 */

const dmSans: FontDetectionResult = {
  fonts: [
    {
      family: "DM Sans",
      evidence: ["font-face", "css-var", "declaration"],
      roles: ["heading", "body", "button"],
      weights: [400, 500, 700],
      selfHosted: true,
      occurrences: 45,
      onGoogleFonts: true,
    },
  ],
  notes: [],
};

describe("formatDetectedFontsForPrompt", () => {
  it("returns empty string when nothing was detected and there is nothing to say", () => {
    expect(formatDetectedFontsForPrompt({ fonts: [], notes: [] })).toBe("");
  });

  it("explains itself when detection ran but found nothing", () => {
    const out = formatDetectedFontsForPrompt({ fonts: [], notes: ["Could not fetch https://x for font detection."] });
    expect(out).toContain("No font families could be extracted");
    expect(out).toContain("Could not fetch");
  });

  it("surfaces roles, weights, self-hosting and Google availability", () => {
    const out = formatDetectedFontsForPrompt(dmSans);
    expect(out).toContain("**DM Sans**");
    expect(out).toContain("theme roles: heading, body, button");
    expect(out).toContain("weights: 400, 500, 700");
    expect(out).toContain("SELF-HOSTED");
    // Drives "name it, don't annotate as a substitution".
    expect(out).toContain("available on Google Fonts (usable by name)");
  });

  it("tells the model when a family needs uploaded files", () => {
    const out = formatDetectedFontsForPrompt({
      fonts: [{ ...dmSans.fonts[0]!, family: "Meno Banner", onGoogleFonts: false }],
      notes: [],
    });
    expect(out).toContain("NOT on Google Fonts (licensed — needs uploaded files)");
  });

  it("flags a CSS slug with its probable real family name", () => {
    // Shopify themes frequently only ever name a face by slug; emitting
    // `font-family: meno-banner` verbatim would never resolve.
    const out = formatDetectedFontsForPrompt({
      fonts: [{ ...dmSans.fonts[0]!, family: "meno-banner", roles: [], weights: [] }],
      notes: [],
    });
    expect(out).toContain('real family name is probably "Meno Banner"');
  });

  it("does not add a slug hint to a normal family name", () => {
    expect(formatDetectedFontsForPrompt(dmSans)).not.toContain("CSS slug");
  });

  it("omits the Google-availability clause when the check did not run", () => {
    const out = formatDetectedFontsForPrompt({
      fonts: [{ ...dmSans.fonts[0]!, onGoogleFonts: null }],
      notes: [],
    });
    expect(out).not.toContain("Google Fonts");
  });
});
