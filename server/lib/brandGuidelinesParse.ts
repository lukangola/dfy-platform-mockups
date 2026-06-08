/**
 * Brand guidelines markdown — read-only structured access.
 *
 * brand.guidelinesMarkdown is the single source of truth for every brand
 * identity field. This file is the deterministic ONE-WAY READ of that
 * markdown for the small number of consumers that need structured field
 * access — primarily:
 *
 *   - server/routes/brands.ts → mirrors `name` (from H1) and `logoUrl`
 *     (from the Logo Usage section's image link) into the dedicated
 *     brand.name + brand.logoUrl columns so the BrandSwitcher chip can
 *     render without parsing markdown.
 *
 *   - server/routes/listicles.ts (HTML render step) → reads the color
 *     palette hex codes for CSS variables and the font family names for
 *     Google Fonts link injection.
 *
 * Everywhere else, the markdown is injected verbatim into the relevant
 * prompt so the LLM has the full voice/tone/imagery/do's & don'ts context.
 *
 * This is NOT a separate extraction method. It's a regex-shaped read of
 * the labelled sections of the markdown. The markdown remains the single
 * authored source; this file just surfaces the bits of it that
 * downstream code needs deterministically.
 */

export type ParsedColor = {
  /** Human-friendly name from the first cell of the row, e.g. "Brand Charcoal". */
  name: string;
  /** Uppercase hex including the leading #, e.g. "#1A1A1A". */
  hex: string;
  /** The usage cell, verbatim — e.g. "Body text, primary UI". */
  usage: string;
};

export type ParsedFont = {
  /** Family name as it appears in the markdown, e.g. "Cormorant Garamond". */
  name: string;
  /** "Primary" | "Secondary" | "Accent / Mono" — derived from which subsection it appeared under. */
  role: string;
};

/**
 * Structured design tokens parsed out of Section 9 (Design System) of
 * the brand guidelines markdown. Every field is intentionally a
 * verbatim CSS-valid string (or null when missing) so consumers can
 * drop the value directly into an inline style or a CSS variable.
 *
 * When the brand markdown lacks Section 9 entirely (brands extracted
 * before the design-tokens prompt was added), all fields are null —
 * downstream code should fall back to its own sensible defaults.
 */
export type ParsedDesignSystem = {
  pageBackground: string | null;       // "#FFFFFF"
  cta: {
    background: string | null;          // "#C97B5C"
    color: string | null;               // "#FFFFFF"
    borderRadius: string | null;        // "8px"
    padding: string | null;             // "14px 28px" (CSS shorthand)
    fontWeight: string | null;          // "600"
    fontTransform: string | null;       // "uppercase" | "none" | "capitalize"
    letterSpacing: string | null;       // "0.04em"
    border: string | null;              // "none" | "1px solid #2B2B2B"
    boxShadow: string | null;           // "none" | "0 1px 3px rgba(0,0,0,0.06)"
    hover: string | null;               // human-readable, e.g. "darkens ~8%"
  };
  secondaryCta: {
    background: string | null;
    color: string | null;
    borderRadius: string | null;
    border: string | null;
    boxShadow: string | null;
  };
  card: {
    background: string | null;
    borderRadius: string | null;
    border: string | null;
    boxShadow: string | null;
  };
  designDna: string | null;            // 1-2 sentence free-text summary
};

export type ParsedGuidelines = {
  /** Brand name from the H1, e.g. "Acme Brand Guidelines" → "Acme". Empty string when missing. */
  name: string;
  /** First image URL inside the `## 2. Logo Usage` → `### Primary Logo` block, absolute. null when missing. */
  logoUrl: string | null;
  /** All primary + secondary + accent colors, in document order. */
  colors: ParsedColor[];
  /** Primary + secondary + accent fonts, in document order — name-validated. */
  fonts: ParsedFont[];
  /** Design system tokens from Section 9. All fields null when section missing. */
  designSystem: ParsedDesignSystem;
};

/**
 * Pull the markdown subtree under a given heading. Heading is matched by
 * the literal text (e.g. "## 3. Color Palette" or "### Primary Logo").
 * The returned slice starts AFTER the heading line and ends right before
 * the next heading of the same OR shallower level (`#`, `##`, `###` etc).
 * Returns the empty string when the heading isn't present.
 */
function sectionBody(markdown: string, headingExact: string): string {
  const lines = markdown.split(/\r?\n/);
  const headingLevel = (headingExact.match(/^#+/) ?? [""])[0].length;
  const idx = lines.findIndex((l) => l.trim() === headingExact);
  if (idx === -1) return "";
  const endRe = new RegExp(`^#{1,${headingLevel}}\\s`);
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (endRe.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  return lines.slice(idx + 1, end).join("\n");
}

/**
 * Pull the H1 brand name, stripping a trailing "Brand Guidelines" suffix.
 * "# Blume Brand Guidelines" → "Blume". "# Acme Co." → "Acme Co.".
 */
function extractName(markdown: string): string {
  const m = markdown.match(/^#\s+(.+?)$/m);
  if (!m) return "";
  return (m[1] ?? "").replace(/\s+brand\s+guidelines\s*$/i, "").trim();
}

/**
 * Pull the first absolute image URL from the Primary Logo subsection of
 * the Logo Usage section. Falls back to scanning the whole `## 2.` block
 * if no Primary Logo subsection is present.
 */
function extractLogoUrl(markdown: string): string | null {
  let body = sectionBody(markdown, "### Primary Logo");
  if (!body.trim()) body = sectionBody(markdown, "## 2. Logo Usage");
  if (!body.trim()) return null;
  // Match a standard markdown image: ![alt](url) — capture the url.
  const m = body.match(/!\[[^\]]*\]\(([^)]+)\)/);
  if (!m || !m[1]) return null;
  const url = m[1].trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

/**
 * Parse every `| Color | Hex | RGB | Usage |`-shaped row in the Color
 * Palette section. Tolerant of missing RGB columns and of header rows.
 *
 * The skill template uses:
 *
 *   | Color | Hex | RGB | Usage |
 *   |-------|-----|-----|-------|
 *   | Brand Cream | #F8F1E5 | 248, 241, 229 | Backgrounds, page fields |
 *
 * but real generated output can vary in column count. We extract rows
 * that have a hex code in any of the first three columns — that's the
 * load-bearing signal.
 */
function extractColors(markdown: string): ParsedColor[] {
  const body = sectionBody(markdown, "## 3. Color Palette");
  if (!body.trim()) return [];
  const rows: ParsedColor[] = [];
  const HEX_RE = /#[0-9A-Fa-f]{6}\b/;
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    // Skip header (`| Color | Hex | ...`) + separator (`|---|---|`) rows.
    if (/^\|[-:\s|]+\|$/.test(line.trim())) continue;
    if (/^\|\s*color\s*\|/i.test(line.trim())) continue;
    const cells = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length < 2) continue;
    // Find the hex cell — could be cell 1 or 2 depending on column shape.
    let hexCell = "";
    for (const c of cells) {
      const hm = c.match(HEX_RE);
      if (hm) {
        hexCell = hm[0].toUpperCase();
        break;
      }
    }
    if (!hexCell) continue;
    const name = cells[0] ?? "";
    const usage = cells[cells.length - 1] ?? "";
    rows.push({ name, hex: hexCell, usage });
  }
  return rows;
}

/**
 * Pull font family names from the Typography section. The skill template
 * lays out:
 *
 *   ### Primary Font
 *   **Cormorant Garamond** — Google Fonts (free license)
 *   ...
 *   ### Secondary Font
 *   **Inter** — ...
 *
 * We pick the first bolded run in each role's subsection — that's where
 * the family name lives. Robust to the bracketed-source suffix being
 * present or absent.
 */
/**
 * A font family name is "loadable" if it can be dropped into
 * `font-family: <name>` AND into a Google Fonts `family=` query
 * without breaking the CSS. The skill prompt is now strict that the
 * value must be a real font name (with descriptive blobs banned), but
 * this is the runtime guard for older markdown that slipped through
 * AND for defending against models that ignore the instruction.
 *
 * Rejects:
 *   - Names with parens, commas, slashes, colons, semicolons — those
 *     break CSS parsing (`font-family: Display Serif (custom — ...)`).
 *   - Names over 40 characters — real font families are short.
 *   - Names starting with a templating placeholder ("font",
 *     "placeholder", "tbd", "unknown", "custom").
 */
export function isLoadableFontName(name: string): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 40) return false;
  if (/[(){}<>:;,/\\]/.test(trimmed)) return false;
  if (/^(font|placeholder|tbd|unknown|custom|unidentified|n\/a)/i.test(trimmed)) return false;
  return true;
}

function extractFonts(markdown: string): ParsedFont[] {
  const sections: { heading: string; role: string }[] = [
    { heading: "### Primary Font", role: "Primary" },
    { heading: "### Secondary Font", role: "Secondary" },
    { heading: "### Accent / Mono Font (optional)", role: "Accent" },
    { heading: "### Accent / Mono Font", role: "Accent" },
  ];
  const seen = new Set<string>();
  const fonts: ParsedFont[] = [];
  for (const { heading, role } of sections) {
    const body = sectionBody(markdown, heading);
    if (!body.trim()) continue;
    const m = body.match(/\*\*([^*]+)\*\*/);
    if (!m) continue;
    const name = (m[1] ?? "").trim();
    if (!isLoadableFontName(name)) continue;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    fonts.push({ name, role });
  }
  return fonts;
}

/**
 * Pull a labeled field's value out of a markdown subsection body.
 * Tolerates leading dash, bold label, and trailing comments.
 *
 *   "- **Background**: #C97B5C — primary CTA"
 *      label = "Background"
 *      → "#C97B5C"
 *
 *   "- **Border radius**: 8 px"
 *      label = "Border radius"
 *      → "8 px"
 *
 * Returns null when the label isn't found or the value is a
 * placeholder ("TBD", "—", empty).
 */
function readField(body: string, label: string): string | null {
  // Case-insensitive label match, allows optional bold + leading dash.
  // Capture group is the value after the colon, up to end of line.
  const re = new RegExp(`^[\\s-]*\\*{0,2}${label.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\*{0,2}\\s*:\\s*(.+?)\\s*$`, "im");
  const m = body.match(re);
  if (!m || !m[1]) return null;
  let v = m[1].trim();
  // Strip trailing inline comment "value — description"
  v = v.replace(/\s+[—–-]\s+.*$/, "").trim();
  if (!v) return null;
  if (/^(tbd|—|–|n\/a|none specified|not specified)$/i.test(v)) return null;
  return v;
}

/**
 * Normalise a "8 px" / "8px" / "12 pixels" → "8px" string. Returns
 * the original value if it doesn't look like a pixel measurement.
 */
function normalisePx(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/^(\d+(?:\.\d+)?)\s*(?:px|pixels?)?\s*$/i);
  if (m) return `${m[1]}px`;
  // Could be "14 px vertical, 28 px horizontal" or "14px 28px" — leave verbatim.
  return v;
}

/** Pull the Design System subsection's structured fields. */
function extractDesignSystem(markdown: string): ParsedDesignSystem {
  const empty: ParsedDesignSystem = {
    pageBackground: null,
    cta: {
      background: null, color: null, borderRadius: null, padding: null,
      fontWeight: null, fontTransform: null, letterSpacing: null,
      border: null, boxShadow: null, hover: null,
    },
    secondaryCta: {
      background: null, color: null, borderRadius: null, border: null, boxShadow: null,
    },
    card: {
      background: null, borderRadius: null, border: null, boxShadow: null,
    },
    designDna: null,
  };
  const root = sectionBody(markdown, "## 9. Design System");
  if (!root.trim()) return empty;

  const pageBg = sectionBody(root, "### Page Background");
  const cta = sectionBody(root, "### Primary CTA Button") || sectionBody(root, "### Primary CTA") || sectionBody(root, "### CTA Button");
  const sec = sectionBody(root, "### Secondary Button");
  const card = sectionBody(root, "### Cards / Section Containers") || sectionBody(root, "### Cards") || sectionBody(root, "### Section Containers");
  const dna = sectionBody(root, "### Design DNA");

  const out: ParsedDesignSystem = {
    pageBackground: readField(pageBg, "Hex"),
    cta: {
      background: readField(cta, "Background"),
      color: readField(cta, "Text color") ?? readField(cta, "Text colour"),
      borderRadius: normalisePx(readField(cta, "Border radius")),
      padding: readField(cta, "Padding"),
      fontWeight: readField(cta, "Font weight"),
      fontTransform: readField(cta, "Font transform"),
      letterSpacing: readField(cta, "Letter spacing"),
      border: readField(cta, "Border"),
      boxShadow: readField(cta, "Box shadow"),
      hover: readField(cta, "Hover"),
    },
    secondaryCta: {
      background: readField(sec, "Background"),
      color: readField(sec, "Text color") ?? readField(sec, "Text colour"),
      borderRadius: normalisePx(readField(sec, "Border radius")),
      border: readField(sec, "Border"),
      boxShadow: readField(sec, "Box shadow"),
    },
    card: {
      background: readField(card, "Background"),
      borderRadius: normalisePx(readField(card, "Border radius")),
      border: readField(card, "Border"),
      boxShadow: readField(card, "Box shadow"),
    },
    designDna: dna.trim() || null,
  };
  return out;
}

/**
 * Score a palette color by how well it matches a target role using the
 * `usage` description text + WCAG contrast against white. Returns a
 * number — higher = better fit.
 */
function scoreCtaColor(c: ParsedColor): number {
  const u = (c.usage || "").toLowerCase();
  let s = 0;
  if (/\b(cta|call.?to.?action|button|primary action|primary call)\b/.test(u)) s += 100;
  if (/\b(sale|emphasis|action|callout|highlight)\b/.test(u)) s += 40;
  // Strong demotion for clear non-CTA roles
  if (/\b(background|page bg|page background|breathing room|white ?space|hero panel|backdrop)\b/.test(u)) s -= 100;
  if (/\b(body text|body copy|paragraph)\b/.test(u)) s -= 50;
  // Contrast against pure white. A CTA on a white page needs ≥ 4.5:1.
  const contrast = wcagContrastWithWhite(c.hex);
  if (contrast >= 4.5) s += 30;
  else if (contrast < 2.5) s -= 80;   // far too light for a CTA on white
  else s -= 20;
  return s;
}

function scoreBackgroundColor(c: ParsedColor): number {
  const u = (c.usage || "").toLowerCase();
  let s = 0;
  if (/\b(background|page bg|page background|breathing room|white ?space|backdrop)\b/.test(u)) s += 100;
  if (/\b(cream|soft|tint|pastel)\b/.test(u)) s += 20;
  // Demote: obvious non-bg roles
  if (/\b(cta|call.?to.?action|button|primary action)\b/.test(u)) s -= 100;
  if (/\b(body text|body copy|headline|wordmark)\b/.test(u)) s -= 50;
  // Backgrounds are LIGHT. Contrast-against-white is small for whites/creams.
  const contrast = wcagContrastWithWhite(c.hex);
  if (contrast < 1.5) s += 30;       // near white — definitely a background
  if (contrast > 4.5) s -= 40;        // too dark for a page bg
  return s;
}

/**
 * Pick the palette color that should be used as the CTA / primary
 * action color. Uses the explicit Design System CTA background when
 * present (single source of truth) — falls back to scoring the palette
 * by usage hint + contrast when the brand's markdown was extracted
 * before Section 9 was a thing.
 *
 * Returns null when nothing scores positive — caller should fall back
 * to a hardcoded default rather than picking a bad color.
 */
export function pickCtaColor(
  ds: ParsedDesignSystem | null,
  palette: ParsedColor[],
): string | null {
  if (ds?.cta?.background && /^#[0-9A-Fa-f]{6}$/.test(ds.cta.background)) return ds.cta.background.toUpperCase();
  if (palette.length === 0) return null;
  const scored = palette.map((c) => ({ c, s: scoreCtaColor(c) }));
  scored.sort((a, b) => b.s - a.s);
  if (scored[0]!.s <= 0) return null;
  return scored[0]!.c.hex;
}

/**
 * Pick the body-text color from the palette. Many DTC brands use a
 * brand-tinted dark (navy, charcoal) for body copy instead of pure
 * `#1F1F1F` — the markdown's "Usage" column tells us which color is
 * the body text. Falls back to null when nothing matches; callers
 * keep their generic dark default in that case.
 */
export function pickBodyTextColor(palette: ParsedColor[]): string | null {
  if (palette.length === 0) return null;
  const score = (c: ParsedColor) => {
    const u = (c.usage || "").toLowerCase();
    let s = 0;
    if (/\b(body text|body copy|paragraph|paragraphs|primary text)\b/.test(u)) s += 100;
    if (/\b(text|copy|reading)\b/.test(u)) s += 20;
    if (/\b(wordmark|logo)\b/.test(u)) s += 30; // logo color often doubles as body text on DTC
    if (/\b(background|page bg|button bg|cta)\b/.test(u)) s -= 100;
    // Body text needs strong contrast on a white-ish page → high contrast.
    const contrast = wcagContrastWithWhite(c.hex);
    if (contrast >= 7) s += 30;       // body-text-grade
    else if (contrast < 4.5) s -= 80; // too light for body text
    return s;
  };
  const scored = palette.map((c) => ({ c, s: score(c) }));
  scored.sort((a, b) => b.s - a.s);
  if (scored[0]!.s <= 0) return null;
  return scored[0]!.c.hex;
}

/**
 * Pick the page background color, prefer the Design System value when
 * present, fall back to scoring palette colors by usage.
 */
export function pickBackgroundColor(
  ds: ParsedDesignSystem | null,
  palette: ParsedColor[],
): string | null {
  if (ds?.pageBackground && /^#[0-9A-Fa-f]{6}$/.test(ds.pageBackground)) return ds.pageBackground.toUpperCase();
  if (palette.length === 0) return null;
  const scored = palette.map((c) => ({ c, s: scoreBackgroundColor(c) }));
  scored.sort((a, b) => b.s - a.s);
  if (scored[0]!.s <= 0) return null;
  return scored[0]!.c.hex;
}

/** WCAG relative-luminance contrast against pure white. 1 = same, 21 = max contrast (black). */
function wcagContrastWithWhite(hex: string): number {
  const lum = relativeLuminance(hex);
  return (1 + 0.05) / (lum + 0.05);
}
function relativeLuminance(hex: string): number {
  const h = hex.replace(/^#/, "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const toLin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

/**
 * Parse the brand guidelines markdown into the small set of structured
 * fields that downstream code needs to read deterministically.
 *
 * NEVER USE THIS FROM A WRITE PATH. The markdown is the source of truth;
 * this function is for reads only.
 */
export function parseBrandGuidelines(markdown: string | null | undefined): ParsedGuidelines {
  const md = (markdown ?? "").trim();
  if (!md) {
    return {
      name: "",
      logoUrl: null,
      colors: [],
      fonts: [],
      designSystem: extractDesignSystem(""),
    };
  }
  return {
    name: extractName(md),
    logoUrl: extractLogoUrl(md),
    colors: extractColors(md),
    fonts: extractFonts(md),
    designSystem: extractDesignSystem(md),
  };
}
