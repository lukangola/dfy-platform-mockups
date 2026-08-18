import { measureImage } from "./imageDims.js";

export type ImageCandidate = {
  url: string;
  width: number | null;
  height: number | null;
  source: "json-ld" | "og:image" | "twitter:image" | "link-image" | "img-srcset" | "img-src";
  score: number;
};

export type UrlMeta = {
  title: string | null;
  image: string | null;
  imageCandidates: ImageCandidate[];
  siteName: string | null;
  description: string | null;
};

function pick(html: string, regex: RegExp): string | null {
  const m = html.match(regex);
  if (!m) return null;
  return decodeEntities(m[1].trim()) || null;
}

function pickAll(html: string, regex: RegExp): string[] {
  const out: string[] = [];
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const val = decodeEntities(m[1].trim());
    if (val) out.push(val);
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * URLs parsed out of HTML attributes carry HTML entities — Shopify emits
 * `?v=123&amp;width=3840` in srcset/src. Left encoded, the query parameter
 * becomes the literal `amp;width`, so the CDN silently ignores the requested
 * render size and serves the original file instead. Decoding here (the single
 * choke point every parsed URL passes through) keeps `width=` effective.
 */
function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, "&")
    .replace(/&#0*38;/g, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function absolutize(maybeUrl: string | null, base: string): string | null {
  if (!maybeUrl) return null;
  try {
    return new URL(decodeHtmlEntities(maybeUrl.trim()), base).toString();
  } catch {
    return null;
  }
}

// Junk image patterns: sprites, icons, logos, tracking pixels, social badges, avatars.
const JUNK_RE =
  /(sprite|icon|favicon|logo|badge|placeholder|blank|pixel|avatar|1x1|transparent|loading|spinner|social[-_]?share|facebook|instagram|twitter[-_]?icon|tiktok[-_]?icon|youtube[-_]?icon|gdpr|cookie|cart[-_]?icon|menu[-_]?icon|search[-_]?icon|arrow|chevron|star[-_]?rating|payment|visa|mastercard|paypal|klarna|afterpay|apple[-_]?pay|google[-_]?pay)/i;

function looksLikeJunk(url: string): boolean {
  return JUNK_RE.test(url);
}

function pickLargestFromSrcset(srcset: string): { url: string; width: number | null } | null {
  // srcset = "url1 320w, url2 640w, url3 1280w" or "url1 1x, url2 2x"
  const parts = srcset.split(",").map((p) => p.trim()).filter(Boolean);
  let best: { url: string; width: number | null } | null = null;
  for (const part of parts) {
    const tokens = part.split(/\s+/);
    const url = tokens[0];
    const descriptor = tokens[1] || "";
    let width: number | null = null;
    if (descriptor.endsWith("w")) width = parseInt(descriptor, 10) || null;
    else if (descriptor.endsWith("x")) width = Math.round((parseFloat(descriptor) || 1) * 1000); // approximate
    if (!best || (width ?? 0) > (best.width ?? 0)) best = { url, width };
  }
  return best;
}

function extractJsonLdImages(html: string): string[] {
  const urls: string[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const raw = m[1].trim();
      const parsed = JSON.parse(raw);
      collectImages(parsed, urls);
    } catch {
      // ignore malformed JSON-LD blocks
    }
  }
  return urls;
}

function collectImages(node: unknown, out: string[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const n of node) collectImages(n, out);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  const isProduct =
    t === "Product" ||
    (Array.isArray(t) && t.includes("Product")) ||
    t === "ProductGroup" ||
    (Array.isArray(t) && t.includes("ProductGroup"));
  if (isProduct && obj.image) {
    pushImage(obj.image, out);
  }
  // Recurse into @graph / nested structures.
  for (const key of Object.keys(obj)) {
    if (key === "image") continue;
    collectImages(obj[key], out);
  }
}

function pushImage(img: unknown, out: string[]): void {
  if (!img) return;
  if (typeof img === "string") {
    out.push(img);
    return;
  }
  if (Array.isArray(img)) {
    for (const i of img) pushImage(i, out);
    return;
  }
  if (typeof img === "object") {
    const obj = img as Record<string, unknown>;
    if (typeof obj.url === "string") out.push(obj.url);
    else if (typeof obj.contentUrl === "string") out.push(obj.contentUrl);
  }
}

function scoreCandidate(
  url: string,
  source: ImageCandidate["source"],
  width: number | null,
  height: number | null,
): number {
  let score = 0;
  // Source weighting.
  const sourceWeights: Record<ImageCandidate["source"], number> = {
    "json-ld": 1000,
    "og:image": 700,
    "twitter:image": 600,
    "link-image": 500,
    "img-srcset": 400,
    "img-src": 200,
  };
  score += sourceWeights[source];

  // Resolution weighting.
  if (width) score += Math.min(width, 4000) / 4;
  if (height) score += Math.min(height, 4000) / 4;

  // Prefer https.
  if (url.startsWith("https://")) score += 20;

  // Penalize obvious junk.
  if (looksLikeJunk(url)) score -= 2000;

  return score;
}

function addCandidate(
  map: Map<string, ImageCandidate>,
  url: string | null,
  source: ImageCandidate["source"],
  width: number | null = null,
  height: number | null = null,
): void {
  if (!url) return;
  if (url.startsWith("data:")) return;
  const key = url.split("#")[0];
  const existing = map.get(key);
  if (existing) {
    // Upgrade dimensions/source if better.
    const newScore = scoreCandidate(key, source, width ?? existing.width, height ?? existing.height);
    if (newScore > existing.score) {
      map.set(key, {
        url: key,
        width: width ?? existing.width,
        height: height ?? existing.height,
        source,
        score: newScore,
      });
    } else if ((width && !existing.width) || (height && !existing.height)) {
      existing.width = width ?? existing.width;
      existing.height = height ?? existing.height;
      existing.score = scoreCandidate(key, existing.source, existing.width, existing.height);
    }
    return;
  }
  map.set(key, { url: key, width, height, source, score: scoreCandidate(key, source, width, height) });
}

export async function fetchUrlMeta(url: string, timeoutMs = 8000): Promise<UrlMeta> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DFYPlatform/1.0; +https://example.com)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return empty();
    const html = (await res.text()).slice(0, 1_000_000); // cap at 1MB

    const ogTitle = pick(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const ogImage = pick(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    const ogImageWidth = pick(html, /<meta[^>]+property=["']og:image:width["'][^>]+content=["']([^"']+)["']/i);
    const ogImageHeight = pick(html, /<meta[^>]+property=["']og:image:height["'][^>]+content=["']([^"']+)["']/i);
    const ogSiteName = pick(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
    const ogDesc = pick(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    const twitterImage = pick(html, /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    const titleTag = pick(html, /<title[^>]*>([^<]+)<\/title>/i);
    const metaDesc = pick(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const linkImage = pick(html, /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i);

    const candidates = new Map<string, ImageCandidate>();

    // 1. JSON-LD Product.image — highest quality source.
    for (const raw of extractJsonLdImages(html)) {
      addCandidate(candidates, absolutize(raw, url), "json-ld");
    }

    // 2. Open Graph + Twitter.
    addCandidate(
      candidates,
      absolutize(ogImage, url),
      "og:image",
      ogImageWidth ? parseInt(ogImageWidth, 10) || null : null,
      ogImageHeight ? parseInt(ogImageHeight, 10) || null : null,
    );
    // Also pick secondary og:image tags (common on Shopify).
    for (const raw of pickAll(html, /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi)) {
      addCandidate(candidates, absolutize(raw, url), "og:image");
    }
    addCandidate(candidates, absolutize(twitterImage, url), "twitter:image");
    addCandidate(candidates, absolutize(linkImage, url), "link-image");

    // 3. <img> srcset — scan up to ~200 imgs.
    const imgRe = /<img\b([^>]*)>/gi;
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = imgRe.exec(html)) !== null && count < 200) {
      count++;
      const attrs = m[1];
      const srcsetMatch = attrs.match(/\bsrcset=["']([^"']+)["']/i);
      const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
      const dataSrcMatch = attrs.match(/\bdata-src=["']([^"']+)["']/i);
      const widthMatch = attrs.match(/\bwidth=["']?(\d+)/i);
      const heightMatch = attrs.match(/\bheight=["']?(\d+)/i);
      const w = widthMatch ? parseInt(widthMatch[1], 10) || null : null;
      const h = heightMatch ? parseInt(heightMatch[1], 10) || null : null;

      if (srcsetMatch) {
        const best = pickLargestFromSrcset(srcsetMatch[1]);
        if (best) addCandidate(candidates, absolutize(best.url, url), "img-srcset", best.width, h);
      }
      if (srcMatch) addCandidate(candidates, absolutize(srcMatch[1], url), "img-src", w, h);
      if (dataSrcMatch) addCandidate(candidates, absolutize(dataSrcMatch[1], url), "img-src", w, h);
    }

    // Rank + filter.
    const ranked = Array.from(candidates.values())
      .filter((c) => !looksLikeJunk(c.url))
      .filter((c) => {
        // Drop tiny images if dimensions are known.
        if (c.width !== null && c.width < 200) return false;
        if (c.height !== null && c.height < 200) return false;
        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // VERIFY REAL PIXELS before anything becomes the product hero.
    //
    // srcset advertises a width DESCRIPTOR, not the file's true size. Shopify
    // lists every variant at `3840w` even when the underlying file is a
    // thumbnail and the CDN will not upscale it. Primal Science Shop's hero
    // was recorded as 3840x5203 and actually served 124x168 — small enough
    // that Kling rejected every video call for that product outright.
    //
    // So: measure the top candidates for real, correct their stored dimensions,
    // and drop the ones too small to use as a model reference. Bounded to
    // VERIFY_TOP_N fetches (this runs once per product creation, not per
    // render) and measurements are cached per-URL.
    const verified = await verifyTopCandidates(ranked);
    const topImage = verified.find((c) => !c.tooSmall)?.url ?? null;

    return {
      title: ogTitle ?? titleTag,
      image: topImage,
      imageCandidates: verified.filter((c) => !c.tooSmall).map(({ tooSmall: _drop, ...c }) => c),
      siteName: ogSiteName,
      description: ogDesc ?? metaDesc,
    };
  } catch {
    return empty();
  } finally {
    clearTimeout(timer);
  }
}

/** How many top-ranked candidates get their real dimensions measured. */
const VERIFY_TOP_N = 6;
/**
 * Minimum usable edge. Kling refuses references under 300x300; we keep the same
 * floor here so a product can never be created with a hero the video models
 * will reject.
 */
const MIN_USABLE_PX = 300;

/**
 * Measure the top candidates and replace the advertised width/height with the
 * truth. Candidates below MIN_USABLE_PX are flagged (caller drops them).
 * Unmeasurable URLs are left as-is and NOT flagged — a slow CDN must not cost
 * us a good image. Candidates past VERIFY_TOP_N keep their advertised numbers;
 * they are gallery filler, never the auto-pick.
 */
async function verifyTopCandidates(
  ranked: ImageCandidate[],
): Promise<Array<ImageCandidate & { tooSmall?: boolean }>> {
  const head = ranked.slice(0, VERIFY_TOP_N);
  const tail = ranked.slice(VERIFY_TOP_N);
  const measured = await Promise.all(
    head.map(async (c) => {
      const dims = await measureImage(c.url);
      if (!dims) return { ...c };
      const tooSmall = Math.min(dims.width, dims.height) < MIN_USABLE_PX;
      return { ...c, width: dims.width, height: dims.height, tooSmall };
    }),
  );
  return [...measured, ...tail];
}

function empty(): UrlMeta {
  return { title: null, image: null, imageCandidates: [], siteName: null, description: null };
}

/** Pure helpers exposed for unit tests (no network). */
export const __testables = { decodeHtmlEntities, absolutize };
