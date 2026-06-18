/**
 * Ad Pipeline — card model helpers + DB store.
 *
 * A card snapshots the CreativeBrief on "Make it mine". Outputs are resolved at
 * read time from `brand_assets` (curated keeper, preferred) falling back to the
 * latest `generations` row (live draft). Both are tagged with `pipelineCardId`.
 */
import type { AdConsoleCreativeBriefLike } from "./adPipelineTypes.js";

export type CardOutput = {
  source: "asset" | "generation";
  kind: "text" | "image";
  text: string | null;
  imageUrl: string | null;
  savedAssetId: string | null;
  generatedAt: string;
};

type SavedAsset = { id: string; url: string; metadata: unknown; createdAt: string };
type LatestGen = { output: unknown; createdAt: string };

/** Resolve the output shown on a card: saved asset wins, else latest generation. */
export function resolveCardOutput(
  format: "video" | "static" | string,
  savedAsset: SavedAsset | null,
  latestGeneration: LatestGen | null,
): CardOutput | null {
  const kind: "text" | "image" = format === "static" ? "image" : "text";
  if (savedAsset) {
    const meta = (savedAsset.metadata ?? {}) as { content?: string };
    return {
      source: "asset",
      kind,
      text: kind === "text" ? meta.content ?? null : null,
      imageUrl: kind === "image" ? savedAsset.url : null,
      savedAssetId: savedAsset.id,
      generatedAt: savedAsset.createdAt,
    };
  }
  if (latestGeneration) {
    const out = (latestGeneration.output ?? {}) as { text?: string; url?: string };
    return {
      source: "generation",
      kind,
      text: kind === "text" ? out.text ?? null : null,
      imageUrl: kind === "image" ? out.url ?? null : null,
      savedAssetId: null,
      generatedAt: latestGeneration.createdAt,
    };
  }
  return null;
}

/** A card may enter `ready` only once a brand asset has been saved for it. */
export function canEnterReady(hasSavedAsset: boolean): boolean {
  return hasSavedAsset;
}

const VIDEO_EXT = /\.(mp4|mov|m3u8|webm|m4v)(\?|$)/i;

/** Pick the most likely video URL from a brief's referenceMediaUrls. */
export function pickVideoUrl(urls: string[]): string | null {
  if (!urls.length) return null;
  return urls.find((u) => VIDEO_EXT.test(u)) ?? urls[0];
}
