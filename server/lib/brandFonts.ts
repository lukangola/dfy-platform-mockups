/**
 * Brand font FILES — real, client-supplied typefaces hosted on fal.storage.
 *
 * A brand names its fonts in the Typography section of `guidelinesMarkdown`
 * (e.g. "Meno Banner", "Sofia Pro"). Those NAMES flow into every generation
 * surface. For most brands the name is a close Google/web font and that's all
 * we have. When a client sends their REAL font files, we host them and record
 * them here on `brands.brandFonts` so the one surface that renders actual HTML
 * — the listicle lander — can embed `@font-face` rules and render in the
 * genuine typeface instead of the browser's fallback.
 *
 * Image-model surfaces (static ads via nano-banana, B-roll video) cannot load
 * a font file — they only ever see the font NAME in their prompt — so they are
 * intentionally unaffected by this module. The family names must MATCH between
 * the guidelines Typography section and the `family` here, so the CSS
 * `font-family: <name>` the lander emits resolves to the `@font-face` we inject.
 */

export type BrandFontRole = "heading" | "body" | "accent";

export type BrandFontFace = {
  /** Which guidelines role this file backs. */
  role: BrandFontRole;
  /**
   * CSS family name — MUST match the family named in the guidelines Typography
   * section (e.g. "Meno Banner") so the lander's `font-family` resolves to the
   * `@font-face` we inject.
   */
  family: string;
  /** fal.storage URL of the regular (upright, weight ~400) face. */
  regularUrl: string | null;
  /** fal.storage URL of the italic face, when the brand supplies one. */
  italicUrl?: string | null;
  /** Generic CSS fallback shown during load / when the file 404s. */
  fallback: "serif" | "sans-serif" | "cursive" | "monospace";
};

/**
 * Map a hosted font URL to the CSS `format(...)` hint. fal.media URLs preserve
 * the uploaded filename (with extension), so the extension is reliable; we
 * default to woff2 when the extension is absent or unknown (the widest-support
 * modern format).
 */
export function fontFormatFromUrl(url: string): string {
  const clean = url.split(/[?#]/)[0] ?? url;
  if (/\.woff2$/i.test(clean)) return "woff2";
  if (/\.woff$/i.test(clean)) return "woff";
  if (/\.otf$/i.test(clean)) return "opentype";
  if (/\.ttf$/i.test(clean)) return "truetype";
  return "woff2";
}

/** CSS-escape a family name for use inside a quoted `font-family` string. */
function quoteFamily(family: string): string {
  return `"${family.replace(/["\\]/g, "")}"`;
}

/**
 * Build the `@font-face` CSS block for a brand's uploaded font files. Returns
 * the empty string when there are no files, so callers can inject
 * unconditionally. Each face with a `regularUrl` (and optional `italicUrl`)
 * emits a rule; entries missing both a family and any URL are skipped.
 */
export function buildFontFaceCss(faces: BrandFontFace[] | null | undefined): string {
  if (!Array.isArray(faces) || faces.length === 0) return "";
  const rules: string[] = [];
  for (const f of faces) {
    if (!f || !f.family) continue;
    if (f.regularUrl) {
      rules.push(
        `@font-face{font-family:${quoteFamily(f.family)};font-style:normal;font-weight:400;font-display:swap;` +
          `src:url("${f.regularUrl}") format("${fontFormatFromUrl(f.regularUrl)}");}`,
      );
    }
    if (f.italicUrl) {
      rules.push(
        `@font-face{font-family:${quoteFamily(f.family)};font-style:italic;font-weight:400;font-display:swap;` +
          `src:url("${f.italicUrl}") format("${fontFormatFromUrl(f.italicUrl)}");}`,
      );
    }
  }
  return rules.join("\n");
}

/**
 * Inject a brand's `@font-face` rules into a rendered HTML document so the
 * page's `font-family` declarations resolve to the real files. Idempotent-ish:
 * the injected `<style id="brand-fonts">` is only added when there is CSS to
 * add. Inserts just before `</head>` (the correct place for font declarations);
 * falls back to right after `<head ...>`, then to prepending, so a
 * slightly-malformed document still gets the fonts.
 */
export function injectBrandFontFaces(
  html: string,
  faces: BrandFontFace[] | null | undefined,
): string {
  const css = buildFontFaceCss(faces);
  if (!css) return html;
  const styleTag = `<style id="brand-fonts">\n${css}\n</style>`;

  const headClose = html.match(/<\/head>/i);
  if (headClose && headClose.index !== undefined) {
    return html.slice(0, headClose.index) + styleTag + "\n" + html.slice(headClose.index);
  }
  const headOpen = html.match(/<head[^>]*>/i);
  if (headOpen && headOpen.index !== undefined) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + "\n" + styleTag + html.slice(at);
  }
  return styleTag + "\n" + html;
}
