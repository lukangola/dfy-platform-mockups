/**
 * Logo normalisation.
 *
 * Why this exists: fal.ai's image generation models (the ones the B-Roll
 * pipeline uses) take "reference image" inputs as raster bitmaps. When we
 * pass an SVG URL as a brand logo reference, the model rejects the request
 * — failing the whole generation run with an opaque "[object Object]"
 * error before the formatError fix, or now with a clearer "invalid image
 * format" message. Either way the user can't generate b-roll for a brand
 * whose logo happens to be SVG.
 *
 * Fix: convert every logo to PNG at the point it enters the system —
 * brand_extract output, PATCH logoUrl, or direct upload. The DB only ever
 * stores raster URLs; downstream consumers don't need to know SVG existed.
 *
 * `sharp` handles SVG → PNG natively via librsvg, which is already part of
 * the sharp install we use elsewhere (screenshot resizing in scrapePage.ts).
 */
import sharp from "sharp";
import { uploadToFalStorage } from "./fal.js";

const SVG_EXTENSION_RE = /\.svg(\?|#|$)/i;
const SVG_MIME_RE = /^image\/svg\+?xml(;|$)/i;

/**
 * Default size we rasterise SVG logos at. SVGs are vector — they have no
 * intrinsic resolution — so we pick a size that's large enough for any
 * downstream UI use (B-roll prompts, thumbnails, navbar headers) without
 * generating an enormous bitmap. 512×512 is a sweet spot: bigger than
 * we'll ever display, small enough that fal's reference-image checks
 * accept it (some models cap at ~2K).
 */
const LOGO_RASTER_SIZE = 512;

/**
 * Cheap test against the URL string. If the URL clearly ends in `.svg`
 * (with optional ?query / #fragment), we can short-circuit and skip the
 * HEAD request. Avoids a round-trip for the common case where logos are
 * hosted on Shopify / brand CDNs with predictable extensions.
 */
export function urlLooksLikeSvg(url: string): boolean {
  if (!url) return false;
  if (SVG_EXTENSION_RE.test(url)) return true;
  // data URLs
  if (url.startsWith("data:image/svg")) return true;
  return false;
}

/**
 * Probe the URL with a GET (HEAD is unreliable on Shopify CDN — it
 * sometimes returns 405). Reads up to ~2MB of body so even SVGs that
 * happen to lack a content-type header get classified correctly.
 *
 * Returns { mime, buffer } so callers don't have to re-fetch.
 */
async function fetchAndClassify(url: string): Promise<{ mime: string; buffer: Buffer }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Logo URL returned HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? "";
  // Cap on size — we don't want a malicious server pushing GBs to us.
  if (buffer.byteLength > 16 * 1024 * 1024) {
    throw new Error(`Logo exceeds 16MB; refusing to load`);
  }
  return { mime: ct.split(";")[0]!.trim(), buffer };
}

/**
 * Detect whether a binary blob is SVG. SVG has no magic bytes — it's
 * XML — so we sniff the first KB for a <svg or <?xml + <svg combo.
 * Used as a fallback when content-type lies (or is missing).
 */
function bufferLooksLikeSvg(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 1024).toString("utf-8").toLowerCase();
  if (head.includes("<svg")) return true;
  if (head.includes("<?xml") && head.includes("svg")) return true;
  return false;
}

/**
 * Convert an SVG buffer to a PNG buffer at LOGO_RASTER_SIZE. Uses sharp's
 * `density` option to render the SVG at a higher DPI before rasterising,
 * which keeps the result crisp at the target size — without density, very
 * small SVGs get blurry when scaled up.
 *
 * Falls back to raw `.resize(...).png()` if density-based rendering fails
 * (some malformed SVGs trigger an internal librsvg error that the simpler
 * pipeline tolerates).
 */
async function svgToPng(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer, { density: 384 })
      .resize({
        width: LOGO_RASTER_SIZE,
        height: LOGO_RASTER_SIZE,
        fit: "inside",
        withoutEnlargement: false,
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .png()
      .toBuffer();
  } catch (firstErr) {
    console.warn("[logoConvert] high-density rasterise failed, retrying simple:", (firstErr as Error).message);
    return sharp(buffer)
      .resize(LOGO_RASTER_SIZE, LOGO_RASTER_SIZE, { fit: "inside" })
      .png()
      .toBuffer();
  }
}

/**
 * Take a brand's logo URL (or null). If it points at an SVG (whether the
 * URL extension says so, the content-type says so, or the bytes say so),
 * download it, convert to PNG via sharp, upload the PNG to fal.storage,
 * and return the NEW PNG URL. If it's already raster — PNG, JPG, WebP —
 * return the input URL unchanged (no re-encode, no re-upload, no
 * round-trip cost).
 *
 * Errors are logged and the ORIGINAL URL returned, so a flaky source CDN
 * doesn't break brand creation outright — worst case the b-roll pipeline
 * sees the SVG and retries, same as before.
 */
export async function ensureLogoIsPng(url: string | null | undefined): Promise<string | null> {
  if (!url) return url ?? null;
  try {
    // Cheap path: extension already says SVG.
    if (urlLooksLikeSvg(url)) {
      const { buffer } = await fetchAndClassify(url);
      const png = await svgToPng(buffer);
      const filename = `brand-logo-${Date.now()}.png`;
      return await uploadToFalStorage(png, "image/png", filename);
    }
    // Uncertain — fetch and look at content-type + magic bytes.
    const { mime, buffer } = await fetchAndClassify(url);
    if (SVG_MIME_RE.test(mime) || bufferLooksLikeSvg(buffer)) {
      const png = await svgToPng(buffer);
      const filename = `brand-logo-${Date.now()}.png`;
      return await uploadToFalStorage(png, "image/png", filename);
    }
    // Already a raster format the b-roll pipeline accepts. Leave alone.
    return url;
  } catch (err) {
    console.warn(`[logoConvert] failed to normalise ${url}:`, err instanceof Error ? err.message : err);
    return url;
  }
}

/**
 * Convert a raw image buffer (from a user upload, e.g. via the
 * `/api/uploads/brand-logo` endpoint). If it's SVG, rasterise to PNG. If
 * it's already raster, normalise to PNG at LOGO_RASTER_SIZE so all stored
 * logos share the same shape and size budget.
 */
export async function normaliseLogoBuffer(buffer: Buffer, mime: string | null): Promise<{ buffer: Buffer; mime: string }> {
  const looksSvg = (mime && SVG_MIME_RE.test(mime)) || bufferLooksLikeSvg(buffer);
  if (looksSvg) {
    const png = await svgToPng(buffer);
    return { buffer: png, mime: "image/png" };
  }
  // Already raster — pass through unchanged so we don't degrade an
  // already-good PNG by recompressing. (We could re-encode for size
  // normalisation, but the existing 8MB upload cap is already protective.)
  return { buffer, mime: mime ?? "image/png" };
}
