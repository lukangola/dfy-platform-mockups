/**
 * Ad Creative Console — "Make it mine" Creative Brief + recreation handoff
 * (Phase 6, spec §11).
 *
 * When the operator selects a feed item, we emit a normalized **Creative Brief**
 * — the seam between this Console and the two EXISTING recreation features:
 *
 *   - Static Ads Recreator  (POST /api/static-ads/recreate) — recreates a static
 *     ad image. Inputs: productId + angleName + a library referenceId + brand
 *     guidelines. Routed here when the source is a STATIC ad.
 *   - Script Rewriting / Copy Engine (POST /api/generate/text/copy_rewrite) —
 *     rewrites a script/transcript/copy. Input: `source_copy` (+ product / angle
 *     / brand_context / offer / language). Routed here for everything that
 *     carries a transcript or copy (organic posts, video ads).
 *
 * Recreation itself is OUT OF SCOPE (spec §11) — this module only builds the
 * normalized brief, decides which app should receive it, flips the feed item to
 * `selected`, and logs the swipe event with the brief attached. The client
 * deep-links into the chosen app with the brief's materials prefilled.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "./db.js";
import { getFeedCard, recordFeedEvent, setFeedItemStatus } from "./adConsoleFeed.js";
import type { AdCreative, FeedItem, OrganicPost } from "../db/schema.js";

export type RecreationApp = "static_ads_recreator" | "script_rewriting";

export type CreativeBrief = {
  feedItemId: string;
  sourceType: "ad" | "organic";
  sourceId: string;
  brandId: string;
  productId: string | null;
  niche: string | null;
  format: string; // "static" | "video"
  /** Which recreation app should receive this brief (spec §11 routing). */
  suggestedApp: RecreationApp;
  /** Creative image/video URLs to recreate from (external — FB / IG / TikTok). */
  referenceMediaUrls: string[];
  thumbnailUrl: string | null;
  /** Best text to seed `source_copy` in the Script Rewriting app. */
  sourceCopy: string | null;
  copy: string | null;
  caption: string | null;
  transcript: string | null;
  hook: string | null;
  cta: string | null;
  landingUrl: string | null;
  advertiserName: string | null;
  /** "Ran 180 days" / "Active 84 days · 9 variations" / "1.2M views". */
  tractionBadge: string | null;
  sourceUrl: string | null;
  language: string; // full name (the Copy Engine wants "English", not "en")
  matchedKeywords: string[];
  brand: { id: string; name: string; websiteUrl: string | null; guidelinesMarkdown: string | null };
};

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Whole-thousands view-count badge: 1234 → "1.2K", 1_200_000 → "1.2M". */
function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

function adTractionBadge(ad: AdCreative): string | null {
  const shares = typeof ad.shares === "number" && ad.shares > 0 ? ad.shares : null;
  const likes = typeof ad.likes === "number" && ad.likes > 0 ? ad.likes : null;
  const parts: string[] = [];
  if (shares != null) parts.push(`${shares.toLocaleString("en-US")} shares`);
  if (likes != null) parts.push(`${likes.toLocaleString("en-US")} likes`);
  return parts.length ? parts.join(" · ") : null;
}

function organicTractionBadge(post: OrganicPost): string | null {
  if (typeof post.views === "number" && post.views > 0) return `${compactNumber(post.views)} views`;
  if (typeof post.likes === "number" && post.likes > 0) return `${compactNumber(post.likes)} likes`;
  return null;
}

/** Spec §11 routing: static ads → recreator; everything else → script rewriting. */
function routeApp(sourceType: "ad" | "organic", format: string): RecreationApp {
  return sourceType === "ad" && format === "static" ? "static_ads_recreator" : "script_rewriting";
}

/**
 * Build the normalized Creative Brief for one feed item. Returns null if the
 * feed item can't be found for this brand, or if it has no joined pooled row.
 */
export async function buildCreativeBrief(brandId: string, feedItemId: string): Promise<CreativeBrief | null> {
  const card = await getFeedCard(brandId, feedItemId);
  if (!card) return null;

  const [brand] = await db
    .select({
      id: schema.brands.id,
      name: schema.brands.name,
      brandUrl: schema.brands.brandUrl,
      nicheType: schema.brands.nicheType,
      guidelinesMarkdown: schema.brands.guidelinesMarkdown,
    })
    .from(schema.brands)
    .where(eq(schema.brands.id, brandId))
    .limit(1);
  if (!brand) return null;

  const matchedKeywords = asStringArray(card.item.matchedKeywords);
  const brandBlock = {
    id: brand.id,
    name: brand.name,
    websiteUrl: brand.brandUrl,
    guidelinesMarkdown: brand.guidelinesMarkdown,
  };

  if (card.item.itemType === "ad" && card.ad) {
    const ad = card.ad;
    const format = ad.format ?? "static";
    return {
      feedItemId: card.item.id,
      sourceType: "ad",
      sourceId: ad.id,
      brandId,
      productId: null, // operator picks the target product in the recreation app
      niche: brand.nicheType,
      format,
      suggestedApp: routeApp("ad", format),
      referenceMediaUrls: asStringArray(ad.mediaUrls),
      thumbnailUrl: ad.thumbnailUrl ?? null,
      sourceCopy: ad.copy ?? null,
      copy: ad.copy ?? null,
      caption: null,
      transcript: ad.transcript ?? null,
      hook: ad.hook ?? null,
      cta: ad.cta ?? null,
      landingUrl: ad.landingUrl ?? null,
      advertiserName: ad.advertiserName ?? null,
      tractionBadge: adTractionBadge(ad),
      sourceUrl: ad.pageUrl ?? null,
      language: "English",
      matchedKeywords,
      brand: brandBlock,
    };
  }

  if (card.item.itemType === "organic" && card.organic) {
    const post = card.organic;
    const sourceCopy = post.transcript ?? post.caption ?? null;
    return {
      feedItemId: card.item.id,
      sourceType: "organic",
      sourceId: post.id,
      brandId,
      productId: null,
      niche: brand.nicheType,
      format: post.format ?? "video",
      suggestedApp: routeApp("organic", post.format ?? "video"),
      referenceMediaUrls: post.mediaUrl ? [post.mediaUrl] : [],
      thumbnailUrl: post.thumbnailUrl ?? null,
      sourceCopy,
      copy: null,
      caption: post.caption ?? null,
      transcript: post.transcript ?? null,
      hook: post.hook ?? null,
      cta: null,
      landingUrl: null,
      advertiserName: post.profileName ?? post.handle ?? null,
      tractionBadge: organicTractionBadge(post),
      sourceUrl: post.postUrl ?? null,
      language: "English",
      matchedKeywords,
      brand: brandBlock,
    };
  }

  return null;
}

/**
 * "Make it mine": build the brief, flip the feed item to `selected`, and log a
 * `select` event carrying the brief + routed app. Returns the brief (for the
 * client to deep-link into the chosen recreation app) or null if not found.
 */
export async function selectFeedItem(
  brandId: string,
  feedItemId: string,
  userId: string | null,
): Promise<{ brief: CreativeBrief; item: FeedItem } | null> {
  const brief = await buildCreativeBrief(brandId, feedItemId);
  if (!brief) return null;
  const item = await setFeedItemStatus(brandId, feedItemId, "selected");
  if (!item) return null;
  await recordFeedEvent({
    brandId,
    feedItemId,
    userId,
    event: "select",
    metadata: { routedApp: brief.suggestedApp, brief },
  });
  return { brief, item };
}

/** "Skip": flip to `skipped` and log a `skip` event. Returns false if not found. */
export async function skipFeedItem(
  brandId: string,
  feedItemId: string,
  userId: string | null,
): Promise<boolean> {
  const item = await setFeedItemStatus(brandId, feedItemId, "skipped");
  if (!item) return false;
  await recordFeedEvent({ brandId, feedItemId, userId, event: "skip" });
  return true;
}
