import { describe, it, expect } from "vitest";
import {
  fontFormatFromUrl,
  buildFontFaceCss,
  injectBrandFontFaces,
  sanitizeBrandFonts,
  type BrandFontFace,
} from "./brandFonts.js";

describe("fontFormatFromUrl", () => {
  it("maps known extensions, ignoring query/hash", () => {
    expect(fontFormatFromUrl("https://x/Meno.woff2")).toBe("woff2");
    expect(fontFormatFromUrl("https://x/Meno.woff?v=2")).toBe("woff");
    expect(fontFormatFromUrl("https://x/Meno.otf#a")).toBe("opentype");
    expect(fontFormatFromUrl("https://x/Meno.ttf")).toBe("truetype");
  });
  it("defaults to woff2 for extensionless/unknown URLs", () => {
    expect(fontFormatFromUrl("https://fal.media/files/abc123")).toBe("woff2");
  });
});

const MENO: BrandFontFace = {
  role: "heading",
  family: "Meno Banner",
  regularUrl: "https://fal.media/f/meno-regular.woff2",
  italicUrl: "https://fal.media/f/meno-italic.woff2",
  fallback: "serif",
};
const SOFIA: BrandFontFace = {
  role: "body",
  family: "Sofia Pro",
  regularUrl: "https://fal.media/f/sofia.woff2",
  fallback: "sans-serif",
};

describe("buildFontFaceCss", () => {
  it("returns empty string for no faces", () => {
    expect(buildFontFaceCss(null)).toBe("");
    expect(buildFontFaceCss([])).toBe("");
  });
  it("emits a normal + italic rule for a face that has both", () => {
    const css = buildFontFaceCss([MENO]);
    expect(css).toContain('font-family:"Meno Banner"');
    expect(css).toContain("font-style:normal");
    expect(css).toContain("font-style:italic");
    expect(css).toContain('url("https://fal.media/f/meno-regular.woff2") format("woff2")');
    expect(css).toContain('url("https://fal.media/f/meno-italic.woff2")');
  });
  it("emits only a normal rule when there is no italic", () => {
    const css = buildFontFaceCss([SOFIA]);
    expect(css).toContain('font-family:"Sofia Pro"');
    expect(css).not.toContain("font-style:italic");
  });
  it("skips entries missing a family or any URL", () => {
    const css = buildFontFaceCss([
      { role: "accent", family: "", regularUrl: "https://x/y.woff2", fallback: "cursive" },
      { role: "accent", family: "Paris Script", regularUrl: null, fallback: "cursive" },
    ]);
    expect(css).toBe("");
  });
});

describe("injectBrandFontFaces", () => {
  const doc = "<!DOCTYPE html><html><head><title>x</title></head><body>hi</body></html>";
  it("injects a style block just before </head>", () => {
    const out = injectBrandFontFaces(doc, [SOFIA]);
    expect(out).toContain('<style id="brand-fonts">');
    expect(out.indexOf('<style id="brand-fonts">')).toBeLessThan(out.indexOf("</head>"));
    expect(out).toContain('font-family:"Sofia Pro"');
  });
  it("is a no-op when there are no faces", () => {
    expect(injectBrandFontFaces(doc, [])).toBe(doc);
    expect(injectBrandFontFaces(doc, null)).toBe(doc);
  });
  it("falls back to after <head> when there is no closing tag", () => {
    const out = injectBrandFontFaces("<head><body>hi", [SOFIA]);
    expect(out).toContain('<style id="brand-fonts">');
    expect(out.indexOf("<head>")).toBeLessThan(out.indexOf('<style id="brand-fonts">'));
  });
});

describe("sanitizeBrandFonts", () => {
  it("returns [] for non-arrays", () => {
    expect(sanitizeBrandFonts(null)).toEqual([]);
    expect(sanitizeBrandFonts("nope")).toEqual([]);
  });
  it("keeps valid faces in canonical role order, drops junk", () => {
    const out = sanitizeBrandFonts([
      { role: "body", family: "Sofia Pro", regularUrl: "https://x/s.woff2", fallback: "sans-serif" },
      { role: "heading", family: "Meno Banner", regularUrl: "https://x/m.woff2", italicUrl: "https://x/mi.woff2", fallback: "serif" },
      { role: "bogus", family: "X", regularUrl: "https://x/x.woff2" },
      { role: "accent", family: "Paris", regularUrl: "http://insecure/p.woff2" }, // non-https url dropped → no urls → skipped
    ]);
    expect(out.map((f) => f.role)).toEqual(["heading", "body"]);
    expect(out[0].family).toBe("Meno Banner");
    expect(out[0].italicUrl).toBe("https://x/mi.woff2");
  });
  it("drops entries with no family or no urls, and last-wins per role", () => {
    const out = sanitizeBrandFonts([
      { role: "heading", family: "", regularUrl: "https://x/a.woff2" },
      { role: "heading", family: "Only Italic", regularUrl: null, italicUrl: "https://x/i.woff2" },
      { role: "heading", family: "Winner", regularUrl: "https://x/w.woff2" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].family).toBe("Winner");
  });
  it("defaults fallback by role when missing/invalid", () => {
    const out = sanitizeBrandFonts([
      { role: "accent", family: "Paris", regularUrl: "https://x/p.woff2" },
      { role: "heading", family: "Meno", regularUrl: "https://x/m.woff2", fallback: "nonsense" },
    ]);
    const accent = out.find((f) => f.role === "accent")!;
    const heading = out.find((f) => f.role === "heading")!;
    expect(accent.fallback).toBe("cursive");
    expect(heading.fallback).toBe("sans-serif");
  });
});
