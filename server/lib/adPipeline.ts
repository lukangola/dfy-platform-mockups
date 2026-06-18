/**
 * Ad Pipeline — card model helpers + DB store.
 *
 * A card snapshots the CreativeBrief on "Make it mine". Outputs are resolved at
 * read time from `brand_assets` (curated keeper, preferred) falling back to the
 * latest `generations` row (live draft). Both are tagged with `pipelineCardId`.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "./db.js";
import { selectFeedItem } from "./adConsoleBrief.js";
import { startEnrichment } from "./adPipelineEnrich.js";
import type { AdPipelineCard } from "../db/schema.js";

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

export type AdPipelineStage = "idea" | "in_production" | "ready";

export type AdPipelineCardWithOutput = AdPipelineCard & { output: CardOutput | null };

/**
 * "Make it mine": flip the feed item to selected (existing selectFeedItem), then
 * snapshot the brief into a new card. `mode: "recreate"` lands the card directly
 * in In Production with the chosen product/angle; `mode: "idea"` lands it in
 * Idea. Kicks off background enrichment. Returns null if the feed item is gone.
 */
export async function createCardFromFeedItem(args: {
  brandId: string;
  feedItemId: string;
  mode: "idea" | "recreate";
  productId?: string | null;
  angleName?: string | null;
  language?: string | null;
  userId: string | null;
}): Promise<AdPipelineCard | null> {
  const selected = await selectFeedItem(args.brandId, args.feedItemId, args.userId);
  if (!selected) return null;
  const brief = selected.brief;

  const [card] = await db
    .insert(schema.adPipelineCards)
    .values({
      brandId: args.brandId,
      stage: args.mode === "recreate" ? "in_production" : "idea",
      sourceType: brief.sourceType,
      format: brief.format,
      brief,
      sourceUrl: brief.sourceUrl ?? null,
      originalScript: brief.transcript ?? null,
      referenceImageUrl: brief.format === "static" ? brief.referenceMediaUrls[0] ?? brief.thumbnailUrl ?? null : null,
      productId: args.productId ?? null,
      angleName: args.angleName ?? null,
      language: args.language ?? "en",
      bgJobStatus: "pending",
    })
    .returning();
  if (!card) return null;

  startEnrichment(card.id);
  return card;
}

/** Latest saved brand asset tagged with this card id (or null). */
async function latestSavedAsset(cardId: string): Promise<SavedAsset | null> {
  const [row] = await db
    .select({
      id: schema.brandAssets.id,
      url: schema.brandAssets.url,
      metadata: schema.brandAssets.metadata,
      createdAt: schema.brandAssets.createdAt,
    })
    .from(schema.brandAssets)
    .where(sql`${schema.brandAssets.metadata}->>'pipelineCardId' = ${cardId}`)
    .orderBy(desc(schema.brandAssets.createdAt))
    .limit(1);
  return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
}

/** Latest rewrite/recreate generation tagged with this card id (or null). */
async function latestGeneration(cardId: string): Promise<LatestGen | null> {
  const [row] = await db
    .select({ output: schema.generations.output, createdAt: schema.generations.createdAt })
    .from(schema.generations)
    .where(sql`${schema.generations.inputs}->>'pipelineCardId' = ${cardId}`)
    .orderBy(desc(schema.generations.createdAt))
    .limit(1);
  return row ? { output: row.output, createdAt: row.createdAt.toISOString() } : null;
}

async function withOutput(card: AdPipelineCard): Promise<AdPipelineCardWithOutput> {
  const [asset, gen] = await Promise.all([latestSavedAsset(card.id), latestGeneration(card.id)]);
  return { ...card, output: resolveCardOutput(card.format, asset, gen) };
}

/** All cards for a brand, newest-updated first, each with its resolved output. */
export async function listCardsWithOutputs(brandId: string): Promise<AdPipelineCardWithOutput[]> {
  const cards = await db
    .select()
    .from(schema.adPipelineCards)
    .where(eq(schema.adPipelineCards.brandId, brandId))
    .orderBy(desc(schema.adPipelineCards.updatedAt));
  return Promise.all(cards.map(withOutput));
}

/** One card with its resolved output (or null if not found / wrong brand). */
export async function getCardWithOutput(brandId: string, cardId: string): Promise<AdPipelineCardWithOutput | null> {
  const [card] = await db
    .select()
    .from(schema.adPipelineCards)
    .where(and(eq(schema.adPipelineCards.id, cardId), eq(schema.adPipelineCards.brandId, brandId)))
    .limit(1);
  return card ? withOutput(card) : null;
}

/** Update mutable fields (stage drag, recreate launch sets product/angle). */
export async function updateCard(
  brandId: string,
  cardId: string,
  patch: { stage?: AdPipelineStage; productId?: string | null; angleName?: string | null; language?: string | null },
): Promise<AdPipelineCard | null> {
  // language is notNull in the schema — strip null so Drizzle's set() accepts the value.
  const { language, ...rest } = patch;
  const setPatch = language != null ? { ...rest, language, updatedAt: new Date() } : { ...rest, updatedAt: new Date() };
  const [card] = await db
    .update(schema.adPipelineCards)
    .set(setPatch)
    .where(and(eq(schema.adPipelineCards.id, cardId), eq(schema.adPipelineCards.brandId, brandId)))
    .returning();
  return card ?? null;
}

/**
 * Auto-advance a card to `ready` when a brand asset is saved for it — unless it's
 * been manually dragged elsewhere already at `ready`. Idempotent. Called from the
 * brand-assets save route.
 */
export async function advanceCardOnAssetSaved(cardId: string): Promise<void> {
  await db
    .update(schema.adPipelineCards)
    .set({ stage: "ready", updatedAt: new Date() })
    .where(eq(schema.adPipelineCards.id, cardId));
}
