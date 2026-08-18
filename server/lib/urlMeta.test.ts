import { describe, it, expect } from "vitest";
import { __testables } from "./urlMeta.js";

const { decodeHtmlEntities, absolutize } = __testables;

describe("decodeHtmlEntities", () => {
  it("decodes the &amp; Shopify emits in srcset/src attributes", () => {
    // Left encoded, the query param becomes literal `amp;width` and the CDN
    // ignores the requested size — this is why Primal Science's stored URLs
    // never actually requested width=3840.
    expect(decodeHtmlEntities("https://x/a.png?v=1&amp;width=3840")).toBe(
      "https://x/a.png?v=1&width=3840",
    );
  });
  it("decodes numeric ampersands and quote entities", () => {
    expect(decodeHtmlEntities("https://x/a.png?v=1&#38;w=2")).toBe("https://x/a.png?v=1&w=2");
    expect(decodeHtmlEntities("&quot;x&quot;")).toBe('"x"');
  });
  it("leaves clean strings untouched", () => {
    const clean = "https://x/a.png?v=1&width=3840";
    expect(decodeHtmlEntities(clean)).toBe(clean);
  });
});

describe("absolutize", () => {
  const base = "https://shop.example.com/products/thing";
  it("decodes entities while resolving, so width= stays effective", () => {
    expect(absolutize("//cdn.shop/f/a.png?v=1&amp;width=3840", base)).toBe(
      "https://cdn.shop/f/a.png?v=1&width=3840",
    );
  });
  it("resolves relative urls against the page", () => {
    expect(absolutize("/cdn/a.png", base)).toBe("https://shop.example.com/cdn/a.png");
  });
  it("returns null for unusable input", () => {
    expect(absolutize(null, base)).toBeNull();
    // Note: with a VALID base almost any string resolves as a relative path
    // (":::" -> <base>/:::), so the only real failure mode is a broken base.
    expect(absolutize("/a.png", "not-a-url")).toBeNull();
  });
});
