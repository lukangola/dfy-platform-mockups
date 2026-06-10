/**
 * Thumbnail generation for static-ad references.
 *
 * Why this exists: the references library is rendered as a grid of dozens of
 * cards. Each card pulls the original ad image (typically a 1080×1350+ JPG /
 * PNG several hundred KB to a few MB). Loading 50+ of those at once stalls
 * the page for many seconds — even on fast connections, the network panel is
 * dominated by these reference images.
 *
 * Fix: at ingest time, resize the source down to a small webp (≤400px on the
 * long side, q≈75) and upload it as a separate fal.storage asset. The grid
 * displays the thumb, and the original imageUrl is reserved for:
 *   - vision calls (deconstruction, niche classify)
 *   - the recreate payload (where fidelity matters)
 *   - the side-panel preview when the user clicks a reference
 *
 * Sharp is already a project dep (logoConvert.ts), so no new install needed.
 */
import sharp from "sharp";
import { uploadToFalStorage } from "./fal.js";

const THUMB_LONG_EDGE = 400;
const THUMB_QUALITY = 75;

/**
 * Fetches an image URL, resizes it to a small webp thumb, and uploads the
 * thumb to fal.storage. Returns the thumb URL. Throws on failure — the
 * caller decides whether to fall back to the original imageUrl.
 */
export async function buildStaticAdThumbnail(sourceUrl: string, baseFilename: string): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`Source image returned HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buildStaticAdThumbnailFromBuffer(buf, baseFilename);
}

/**
 * Same as above but skips the network round-trip when we already have the
 * source bytes in hand (e.g. local-file ingest path).
 */
export async function buildStaticAdThumbnailFromBuffer(
  buffer: Buffer,
  baseFilename: string,
): Promise<string> {
  const thumb = await sharp(buffer)
    .rotate() // honour EXIF orientation
    .resize({ width: THUMB_LONG_EDGE, height: THUMB_LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer();
  // Strip the original extension and append `-thumb.webp` so the storage
  // filename makes its purpose obvious.
  const base = baseFilename.replace(/\.[^.]+$/, "");
  return uploadToFalStorage(thumb, "image/webp", `${base}-thumb.webp`);
}
