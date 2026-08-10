/**
 * Deterministic typeface detection from a brand's live site.
 *
 * WHY THIS EXISTS
 *
 * The brand_guidelines prompt tells the model to "inspect the raw HTML/CSS"
 * for `@font-face` rules and `--font-*` custom properties. That instruction was
 * never actually satisfiable: the model reaches the site through `web_fetch`,
 * which hands back readable page content with `<style>` blocks and linked
 * stylesheets stripped. So the CSS the instruction points at is invisible, the
 * model falls through to "closest Google Fonts substitute", and the guideline
 * records a confident-looking guess with the caveat buried in prose.
 *
 * That silently mis-branded every downstream surface. Leven Rose renders
 * entirely in DM Sans (11 theme variables, self-hosted as content-hashed
 * .woff2 with no Google `<link>` to read) and was recorded as Cormorant
 * Garamond + Inter — a display serif where the brand uses a geometric sans.
 * Puzzle® Makeup hit the same failure mode.
 *
 * The fix is to stop asking the model to do it. We fetch the HTML and its
 * stylesheets ourselves, pull the font signals out with plain parsing, and hand
 * the model a short evidence block as ground truth. Detection is now a
 * deterministic input to the prompt rather than something the model has to
 * discover — the model still writes the guidelines, it just no longer has to
 * guess at the one fact it structurally couldn't see.
 *
 * Deliberately dependency-free regex parsing, not a real CSS parser: we want a
 * ranked shortlist of family names plus where each was seen, and this never
 * runs in a hot path (once per brand research run).
 */

/** Where a family name was observed. Ordered loosely by how much we trust it. */
export type FontEvidence =
  | "google-link" // <link href="fonts.googleapis.com/css2?family=NAME">
  | "css-var" // --font-heading-family: "NAME"
  | "font-face" // @font-face { font-family: "NAME" }
  | "declaration"; // font-family: "NAME", ... on some selector

export type DetectedFont = {
  /** Family name exactly as written in the CSS, e.g. "DM Sans". */
  family: string;
  evidence: FontEvidence[];
  /** Role hints harvested from custom-property names (`--font-heading-family` → "heading"). */
  roles: string[];
  /** Weights seen in Google links / @font-face / theme weight vars. */
  weights: number[];
  /** True when the face is served by the site itself rather than a Google link. */
  selfHosted: boolean;
  /** How many times the family appears across all inspected CSS — prominence proxy. */
  occurrences: number;
  /** null until checked; true when the family resolves on Google Fonts. */
  onGoogleFonts: boolean | null;
};

export type FontDetectionResult = {
  fonts: DetectedFont[];
  /** Human-readable notes for the prompt (e.g. Typekit seen, stylesheet fetch failures). */
  notes: string[];
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Never a brand typeface: CSS keywords, the OS/web-safe stack every reset
 * falls back to, and UI-library icon fonts. Without the last two groups a
 * storefront's fallback chain and its carousel's glyph font outrank the real
 * brand face — observed on puzzlemakeup.com ("Times", "courier new") and
 * levenrose.com ("swiper-icons").
 */
const GENERIC = new Set([
  // CSS keywords + generic families
  "inherit", "initial", "unset", "revert", "serif", "sans-serif", "monospace", "cursive",
  "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
  "math", "emoji", "fangsong", "auto", "none", "sans", "-apple-system", "blinkmacsystemfont",
  // Web-safe / OS stack
  "segoe ui", "roboto", "helvetica", "helvetica neue", "arial", "arial black", "times",
  "times new roman", "courier", "courier new", "georgia", "verdana", "tahoma", "geneva",
  "trebuchet ms", "impact", "comic sans ms", "palatino", "palatino linotype", "book antiqua",
  "lucida grande", "lucida sans unicode", "ms sans serif", "new york", "sf pro text",
  "apple color emoji", "segoe ui emoji", "segoe ui symbol", "noto color emoji",
]);

/** Icon/glyph fonts shipped by UI libraries — present on the page, never the brand's type. */
const ICON_FONT_RE =
  /(^|[\s-_])(icons?|glyphicons?|fontawesome|font awesome|ionicons|material icons|feather|bootstrap-icons|icomoon|swiper)([\s-_]|$)/i;

function isRealFamily(name: string): boolean {
  const n = name.trim();
  if (n.length < 2 || n.length > 50) return false;
  if (GENERIC.has(n.toLowerCase())) return false;
  if (ICON_FONT_RE.test(n)) return false;
  if (n.startsWith("--") || n.startsWith("var(")) return false;
  // Real family names are words, not expressions.
  if (/[{}();:]/.test(n)) return false;
  if (!/[A-Za-z]/.test(n)) return false;
  return true;
}

function cleanFamily(raw: string): string {
  return raw
    .trim()
    .replace(/!\s*important\s*$/i, "") // `font-family: "Sofia Pro Regular"!important`
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\+/g, " ") // Google `family=DM+Sans`
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Themes reference one family under several spellings — `"Sofia Pro"` in the
 * @font-face and `sofia-pro` in the declarations. Fold them onto one key so a
 * single family doesn't occupy three shortlist slots and split its own score.
 */
function familyKey(name: string): string {
  return name.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * When variants collide, keep the most human-readable spelling: a properly
 * spaced/capitalised "Sofia Pro" over the slug "sofia-pro". That string is what
 * ends up in the guidelines and, ultimately, in `font-family:`.
 */
function betterDisplayName(a: string, b: string): string {
  const score = (s: string) =>
    (/\s/.test(s) ? 2 : 0) + (/[A-Z]/.test(s) ? 1 : 0) + (/[-_]/.test(s) ? -1 : 0);
  const sa = score(a), sb = score(b);
  if (sa !== sb) return sa > sb ? a : b;
  return a.length <= b.length ? a : b;
}

async function fetchText(url: string, timeoutMs = 15000, maxBytes = 3_000_000): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return Buffer.from(buf.slice(0, maxBytes)).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Is this family actually available on Google Fonts? Lets the guidelines say
 * "use the name" (free Google family) vs "the client must send the files"
 * (licensed/self-hosted) instead of leaving that to guesswork. A 400 from the
 * css2 endpoint means "unknown family".
 */
export async function isGoogleFontFamily(family: string): Promise<boolean> {
  const q = encodeURIComponent(family.trim()).replace(/%20/g, "+");
  try {
    const res = await fetch(`https://fonts.googleapis.com/css2?family=${q}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * `String.matchAll` returns an iterator, and this project type-checks without
 * `downlevelIteration`, so iterating or spreading one is a compile error. An
 * explicit exec loop keeps the parsing readable without touching tsconfig.
 */
function allMatches(re: RegExp, input: string): RegExpExecArray[] {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const rx = new RegExp(re.source, flags);
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(input)) !== null) {
    out.push(m);
    if (m.index === rx.lastIndex) rx.lastIndex++; // zero-length match guard
  }
  return out;
}

type Acc = Map<string, DetectedFont>;

function bump(acc: Acc, rawFamily: string, ev: FontEvidence, opts: { role?: string; weights?: number[]; selfHosted?: boolean } = {}) {
  const family = cleanFamily(rawFamily);
  if (!isRealFamily(family)) return;
  const key = familyKey(family);
  const cur: DetectedFont = acc.get(key) ?? {
    family, evidence: [], roles: [], weights: [], selfHosted: false, occurrences: 0, onGoogleFonts: null,
  };
  cur.family = betterDisplayName(cur.family, family);
  if (!cur.evidence.includes(ev)) cur.evidence.push(ev);
  if (opts.role && !cur.roles.includes(opts.role)) cur.roles.push(opts.role);
  for (const w of opts.weights ?? []) if (!cur.weights.includes(w)) cur.weights.push(w);
  if (opts.selfHosted) cur.selfHosted = true;
  cur.occurrences += 1;
  acc.set(key, cur);
}

/** Parse a blob of CSS (inline <style> or a fetched stylesheet) for font signals. */
function harvestCss(css: string, acc: Acc) {
  // @font-face { font-family: "X"; src: url(...) } — the site serving its own file.
  for (const block of css.match(/@font-face\s*\{[^}]*\}/gi) ?? []) {
    const fam = block.match(/font-family\s*:\s*([^;}]+)/i)?.[1];
    if (!fam) continue;
    const wRaw = block.match(/font-weight\s*:\s*(\d{2,3})/i)?.[1];
    // A Google-hosted src still means the brand uses the family, but it isn't
    // "self-hosted" — that distinction drives the upload-files recommendation.
    const selfHosted = !/fonts\.gstatic\.com|fonts\.googleapis\.com/i.test(block);
    bump(acc, fam.split(",")[0]!, "font-face", { weights: wRaw ? [Number(wRaw)] : [], selfHosted });
  }

  // Theme custom properties: --font-heading-family: "DM Sans", sans-serif;
  for (const m of allMatches(/--font-([a-z0-9-]*?)-?family\s*:\s*([^;}]+)/gi, css)) {
    const roleRaw = (m[1] ?? "").replace(/-+$/, "");
    const role = roleRaw || "base";
    bump(acc, (m[2] ?? "").split(",")[0]!, "css-var", { role });
  }

  // Plain declarations — prominence signal.
  for (const m of allMatches(/font-family\s*:\s*([^;}{]+)/gi, css)) {
    const first = (m[1] ?? "").split(",")[0]!;
    if (/var\(/i.test(first)) continue; // resolved via the custom property above
    bump(acc, first, "declaration");
  }
}

/** Pull families + weights out of a Google Fonts stylesheet URL. */
function harvestGoogleLink(href: string, acc: Acc) {
  for (const m of allMatches(/family=([^&:]+)(?::([^&]*))?/gi, href)) {
    const fam = decodeURIComponent(m[1] ?? "").replace(/\+/g, " ");
    const weights = allMatches(/(\d{3})/g, m[2] ?? "").map((x) => Number(x[1]));
    bump(acc, fam, "google-link", { weights });
  }
}

/**
 * Rank detected families. CSS custom properties are the strongest signal on
 * themed storefronts (Shopify/Dawn expose exactly the roles we care about),
 * Google links are strong and unambiguous, @font-face proves the brand ships
 * the face itself, and bare declarations are weakest (often third-party
 * widgets). Prominence breaks ties.
 */
function score(f: DetectedFont): number {
  let s = 0;
  if (f.evidence.includes("css-var")) s += 100;
  if (f.evidence.includes("google-link")) s += 80;
  if (f.evidence.includes("font-face")) s += 60;
  if (f.evidence.includes("declaration")) s += 10;
  if (f.roles.some((r) => /head|display|title/.test(r))) s += 15;
  if (f.roles.some((r) => /body|base|text/.test(r))) s += 15;
  s += Math.min(f.occurrences, 25);
  return s;
}

/**
 * Detect the typefaces a brand's site actually uses.
 *
 * Fetches the page, its inline styles, and up to `maxStylesheets` linked
 * stylesheets, then ranks what it finds. Never throws — detection is an
 * enrichment step, and a brand research run must still succeed (falling back to
 * the model's own judgement) when a site blocks us or is slow.
 */
export async function detectSiteFonts(
  pageUrl: string,
  { maxStylesheets = 5, checkGoogle = true }: { maxStylesheets?: number; checkGoogle?: boolean } = {},
): Promise<FontDetectionResult> {
  const notes: string[] = [];
  const acc: Acc = new Map();

  const html = await fetchText(pageUrl);
  if (!html) return { fonts: [], notes: [`Could not fetch ${pageUrl} for font detection.`] };

  // 1) Google Fonts <link>s.
  for (const tag of html.match(/<link[^>]+>/gi) ?? []) {
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href && /fonts\.googleapis\.com/i.test(href)) harvestGoogleLink(href, acc);
  }
  if (/use\.typekit\.net|p\.typekit\.net/i.test(html)) {
    notes.push("Adobe Fonts (Typekit) is loaded — some families may be licensed via Adobe.");
  }

  // 2) Inline <style> blocks — where Shopify themes put their font variables.
  for (const m of allMatches(/<style[^>]*>([\s\S]*?)<\/style>/gi, html)) harvestCss(m[1] ?? "", acc);

  // 3) Same-origin stylesheets.
  const base = new URL(pageUrl);
  const sheets: string[] = [];
  for (const tag of html.match(/<link[^>]+>/gi) ?? []) {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || /fonts\.googleapis\.com/i.test(href)) continue;
    try {
      const abs = new URL(href, base).toString();
      if (new URL(abs).origin === base.origin && !sheets.includes(abs)) sheets.push(abs);
    } catch { /* malformed href — skip */ }
  }
  const picked = sheets.slice(0, maxStylesheets);
  const fetched = await Promise.all(picked.map((u) => fetchText(u, 12000, 2_000_000)));
  let failed = 0;
  fetched.forEach((css, i) => (css ? harvestCss(css, acc) : (failed++, void picked[i])));
  if (failed) notes.push(`${failed} of ${picked.length} stylesheets could not be fetched.`);

  let fonts = Array.from(acc.values()).sort((a, b) => score(b) - score(a)).slice(0, 6);

  // 4) Which of these can be used by NAME (free on Google) vs need real files?
  if (checkGoogle && fonts.length) {
    const flags = await Promise.all(fonts.map((f) => isGoogleFontFamily(f.family)));
    fonts = fonts.map((f, i) => ({ ...f, onGoogleFonts: flags[i]! }));
  }
  return { fonts, notes };
}

/**
 * Render the detection result as the evidence block injected into the
 * brand_guidelines prompt. Returns "" when nothing was detected, so the prompt
 * falls back to its existing (model-driven) behaviour rather than being handed
 * an empty authoritative-looking section.
 */
export function formatDetectedFontsForPrompt(result: FontDetectionResult): string {
  if (!result.fonts.length) {
    return result.notes.length ? `No font families could be extracted automatically. ${result.notes.join(" ")}` : "";
  }
  const lines = result.fonts.map((f) => {
    // Themes often only ever name a face by its slug (`meno-banner`). That
    // string would go straight into `font-family:`, so flag the likely proper
    // spelling rather than silently rewriting it — the model decides.
    const slugLike = /^[a-z0-9]+([-_][a-z0-9]+)+$/.test(f.family);
    const titled = slugLike
      ? f.family.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
      : null;
    const bits = [
      `**${f.family}**`,
      titled ? `CSS slug — real family name is probably "${titled}"` : null,
      `seen in: ${f.evidence.join(", ")}`,
      f.roles.length ? `theme roles: ${f.roles.join(", ")}` : null,
      f.weights.length ? `weights: ${f.weights.slice().sort((a, b) => a - b).join(", ")}` : null,
      f.selfHosted ? "SELF-HOSTED by the brand" : null,
      f.onGoogleFonts === true ? "available on Google Fonts (usable by name)"
        : f.onGoogleFonts === false ? "NOT on Google Fonts (licensed — needs uploaded files)"
        : null,
      `occurrences: ${f.occurrences}`,
    ].filter(Boolean);
    return `- ${bits.join(" — ")}`;
  });
  if (result.notes.length) lines.push(`- _Notes: ${result.notes.join(" ")}_`);
  return lines.join("\n");
}
