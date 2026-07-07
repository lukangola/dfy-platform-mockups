/**
 * Durable organic covers.
 *
 * TikTok and Instagram cover/thumbnail URLs are SIGNED and expire within hours
 * (`*-common-sign.tiktokcdn-*.com`, `*.cdninstagram.com`). We used to store the
 * raw signed URL as `organic_posts.thumbnail_url`, so by the time an operator
 * opened the feed the cover 403'd and the card painted black.
 *
 * The fix: re-host the cover on fal's permanent storage. At INGEST the signed
 * URL is still fresh, so we download it directly. For BACKFILL of already-expired
 * rows, TikTok's public oEmbed endpoint hands back a FRESH cover URL we can
 * download instead. Either way we upload the bytes to fal.storage and persist
 * that permanent, CORS-open URL — it never expires.
 *
 * Every function here is best-effort and never throws: a cover that can't be
 * resolved just leaves the original URL in place and the card falls back to its
 * placeholder.
 */
import { uploadToFalStorage } from "./fal.js";

// Some CDNs (TikTok, IG) 403 a header-less fetch — send a real browser UA.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const IMG_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
const MAX_COVER_BYTES = 8 * 1024 * 1024; // 8 MB safety cap
const FETCH_TIMEOUT_MS = 15_000;

/**
 * True if `url` already points at fal's permanent storage (fal.media /
 * fal.storage). Such covers never expire, so we never re-host them.
 */
export function isDurableCoverUrl(url: string | null | undefined): boolean {
  return !!url && /fal\.media|fal\.storage/i.test(url);
}

function extFromMime(mime: string): string {
  if (/png/i.test(mime)) return "png";
  if (/webp/i.test(mime)) return "webp";
  if (/gif/i.test(mime)) return "gif";
  return "jpg";
}

/** Fetch an image URL → { buffer, mime }, or null on any failure / non-image. */
async function fetchImageBuffer(url: string): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: IMG_ACCEPT },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0]!.trim();
    if (!/^image\//i.test(mime)) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength === 0 || ab.byteLength > MAX_COVER_BYTES) return null;
    return { buffer: Buffer.from(ab), mime };
  } catch {
    return null;
  }
}

/**
 * TikTok's public oEmbed endpoint → a FRESH (unexpired) cover URL, or null.
 * Works even when the originally-scraped cover has long since expired, which
 * makes it the backfill path for legacy rows (no paid re-scrape required).
 */
export async function fetchFreshTiktokCover(postUrl: string | null | undefined): Promise<string | null> {
  if (!postUrl || !/tiktok\.com/i.test(postUrl)) return null;
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(postUrl)}`, {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { thumbnail_url?: unknown };
    return typeof j.thumbnail_url === "string" && j.thumbnail_url.trim() ? j.thumbnail_url : null;
  } catch {
    return null;
  }
}

/**
 * Re-host an organic post's cover on fal.storage so it never expires.
 *
 * Returns a permanent fal.media URL, or null if the cover could not be resolved
 * (caller keeps the original URL; the card falls back to a placeholder). Order:
 *   1. If the cover is already durable → return it untouched.
 *   2. Download the cover URL we have (fresh at ingest time).
 *   3. If that fails and it's a TikTok post → refetch a fresh cover via oEmbed.
 *   4. Upload the bytes to fal.storage.
 *
 * Best-effort: never throws.
 */
export async function persistOrganicCover(input: {
  source: string; // "tiktok" | "instagram"
  coverUrl: string | null | undefined;
  postUrl?: string | null;
  externalId?: string | null;
}): Promise<string | null> {
  const { source, coverUrl, postUrl, externalId } = input;
  if (isDurableCoverUrl(coverUrl)) return coverUrl!;

  // 1) The cover URL we already have (still fresh at ingest time).
  let img = coverUrl ? await fetchImageBuffer(coverUrl) : null;

  // 2) Expired/missing → TikTok exposes a fresh cover via public oEmbed.
  if (!img && source === "tiktok") {
    const fresh = await fetchFreshTiktokCover(postUrl);
    if (fresh) img = await fetchImageBuffer(fresh);
  }

  if (!img) return null;
  try {
    const name = `organic-cover-${source}-${externalId ?? "x"}.${extFromMime(img.mime)}`;
    return await uploadToFalStorage(img.buffer, img.mime, name);
  } catch (err) {
    console.error(
      `[ad-console] cover re-host failed (${source} ${externalId ?? "?"}):`,
      (err as Error)?.message ?? err,
    );
    return null;
  }
}
