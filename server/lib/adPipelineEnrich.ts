/**
 * Ad Pipeline background enrichment. On card creation we either transcribe the
 * video (reusing fal/whisper) or create a static_ad_reference + deconstruct it
 * (reusing runDeconstruction). Run state is kept in-memory per card, mirroring
 * adConsolePull.ts — transient progress for a single-instance tool.
 */
import { pickVideoUrl } from "./adPipeline.js";

export type EnrichmentPlan =
  | { kind: "use_existing_transcript"; transcript: string }
  | { kind: "transcribe"; audioUrl: string }
  | { kind: "deconstruct"; imageUrl: string }
  | { kind: "noop" };

/** Decide what enrichment a freshly-created card needs (pure). */
export function enrichmentPlan(card: {
  format: string;
  transcript: string | null;
  referenceMediaUrls: string[];
}): EnrichmentPlan {
  if (card.format === "static") {
    const imageUrl = card.referenceMediaUrls[0];
    return imageUrl ? { kind: "deconstruct", imageUrl } : { kind: "noop" };
  }
  // video / organic
  if (card.transcript && card.transcript.trim()) {
    return { kind: "use_existing_transcript", transcript: card.transcript.trim() };
  }
  const audioUrl = pickVideoUrl(card.referenceMediaUrls);
  return audioUrl ? { kind: "transcribe", audioUrl } : { kind: "noop" };
}
