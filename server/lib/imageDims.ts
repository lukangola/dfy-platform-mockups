/**
 * Reference-image size guard for video generation.
 *
 * Kling rejects any reference image under 300x300:
 *   422 "frontal_image_url: Image dimensions are too small.
 *        Minimum dimensions are 300x300 pixels."
 *
 * That is a HARD failure for the whole clip, even when every other reference in
 * the bundle is fine. It bit Primal Science Shop on 2026-08-14..18: their
 * scraped product photo was a 124x168 thumbnail, so every Single Scene video
 * died — while the product's own generated reference sheet (1536x2752) sat
 * unused in the same bundle.
 *
 * Rather than let one bad source asset kill the render, we measure the
 * references and drop the unusable ones. Fidelity degrades (we lose that
 * anchor) instead of the user getting nothing.
 *
 * Measurement means fetching bytes, so results are cached per-process and keyed
 * by URL: a job's product refs are shared across all its items, so a 12-shot
 * batch measures them once, not 12x.
 */
import sharp from "sharp";

const MIN_REF_PX = 300;
const cache = new Map<string, { width: number; height: number } | null>();

/**
 * Decode just enough of the image to read its real dimensions. Returns null
 * when the URL is unreachable or undecodable — callers treat null as "unknown",
 * NOT as "too small", so a flaky CDN never silently strips a good reference.
 */
export async function measureImage(url: string): Promise<{ width: number; height: number } | null> {
  if (cache.has(url)) return cache.get(url)!;
  let result: { width: number; height: number } | null = null;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(buf).metadata();
      if (meta.width && meta.height) result = { width: meta.width, height: meta.height };
    }
  } catch {
    result = null;
  }
  cache.set(url, result);
  return result;
}

/**
 * Which of these reference URLs are big enough for the video model? Unknown
 * (unmeasurable) URLs are KEPT — see measureImage. Measured in parallel.
 */
export async function usableReferences(urls: string[], minPx = MIN_REF_PX): Promise<Set<string>> {
  const entries = await Promise.all(
    urls.map(async (u) => {
      const dims = await measureImage(u);
      if (!dims) return [u, true] as const; // unknown → keep
      return [u, Math.min(dims.width, dims.height) >= minPx] as const;
    }),
  );
  return new Set(entries.filter(([, ok]) => ok).map(([u]) => u));
}

/** Exposed for tests — lets a case start from a clean cache. */
export function __clearMeasureCache(): void {
  cache.clear();
}
