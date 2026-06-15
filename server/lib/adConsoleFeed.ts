/**
 * Ad Creative Console — relevance + dedup + composite ranking (Phase 5).
 *
 * Materializes the per-brand ranked queue (`feed_items`) from the two GLOBAL
 * pools (`ad_creatives`, `organic_posts`). This is the "merged brand feed" of
 * spec §5/§6: BRAND FEED = niche stream ∪ brand overlay → deduped → ranked.
 *
 * Pure + deterministic — NO Apify, NO LLM. `tractionScore` is already baked
 * into the pooled rows (longevity for ads, views+engagement for organic). Here
 * we add the BRAND-SPECIFIC half:
 *   - relevance — lexical keyword-match strength of the item's text against the
 *     brand's `keyword_extract` output (spec §7: keep it cheap). Two-word
 *     keywords weigh more than broad one-word anchors.
 *   - composite — weighted blend of traction · relevance · recency (weights
 *     from the niche stream's tuned config, else the seed default).
 *
 * Two rails are produced here:
 *   - `competitor_ads`   — ads from the brand's niche stream ∪ its competitors.
 *   - `trending_organic` — organic posts from the brand's niche stream.
 * The `weekly_ideas` rail is LLM-GENERATED (separate generator) — not pooled
 * creatives — so it is intentionally NOT produced by this ranker.
 *
 * Re-ranking is idempotent: upsert on (brandId, refKey) refreshes the scores
 * but PRESERVES the swipe `status`, so a re-rank never un-skips an item.
 */
import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { db, schema } from "./db.js";
import { getBrandNicheState } from "./adConsoleNiche.js";
import { ORGANIC_MIN_DURATION_SEC } from "./adConsoleOrganic.js";
import { DEFAULT_NICHE_CONFIG, type NicheStreamConfig } from "./nicheConfig.js";
import type { AdCreative, FeedItem, NicheStream, OrganicPost } from "../db/schema.js";

// ── Ad traction sub-blend ────────────────────────────────────────────────────
// gethookd's `performance_score` is its own quality composite, but we enrich it
// with two always-present signals it under-weights:
//   - LONGEVITY (days_active): the best available proxy for sustained ad spend.
//     gethookd's actual spend field is populated for <20% of ads and only as a
//     coarse "$0–500" band, so it's unusable — but an ad that's run 90+ days is
//     one the advertiser keeps paying for, i.e. it works.
//   - SCALING (used_count): an advertiser running many variants of one creative
//     is scaling a proven winner.
const TRACTION_PERF_W = 0.5;
const TRACTION_LONGEVITY_W = 0.35;
const TRACTION_SCALE_W = 0.15;
const LONGEVITY_SATURATION_DAYS = 90; // 90+ days live ⇒ full longevity credit
const VARIATION_SATURATION = 4; // used_count 5+ ⇒ full scaling credit

// Pooled ads are here because they're in the brand's niche or from a tracked
// competitor — a sparse-copy ad can still be relevant, so never disqualify it.
// Keyword-copy matches score ABOVE this floor; researched competitors score 1.0.
const RELEVANCE_FLOOR = 0.4;

// Weighted keyword-match score saturates here (≈ this many two-word hits = 1.0).
const RELEVANCE_SATURATION = 5;
// Two-word phrases are specific signal; one-word anchors are broad — weigh less.
const PHRASE_WEIGHT = 1;
const WORD_WEIGHT = 0.4;
// Recency decays linearly to 0 across this window. Wider than the organic
// recency filter so a long-running (older) ad still earns partial recency while
// its traction score carries the longevity signal.
const RECENCY_WINDOW_DAYS = 180;
const DAY_MS = 86_400_000;

// Ads pulled from a RESEARCHED competitor's own ad-library page (competitorId
// set) are the operator's primary target, so we nudge them up the otherwise-0..1
// composite. A soft +0.3 (not a hard +1.0 tier) keeps competitors leading while
// letting a standout niche ad — relevance 1.0 + strong traction — interleave.
const COMPETITOR_AD_BOOST = 0.3;

// Organic ranks on: relevance (which angle keyword SURFACED the clip — not its
// caption) as the lead signal, then traction (engagement-RATE + reach), then recency.
const ORGANIC_WEIGHTS: NicheStreamConfig["weights"] = { traction: 0.4, relevance: 0.5, recency: 0.1 };

// Organic traction blends ENGAGEMENT-RATE (the platform virality metric ÷ views)
// with REACH (log views), so a high-resonance clip ranks above one that's merely
// big — but a tiny clip with a freak ratio can't outrank a genuinely viral one.
// Rate saturations differ by platform: TikTok save-rates run higher than IG
// share-rates. (All tunable.)
const ORGANIC_RATE_W = 0.65;
const ORGANIC_REACH_W = 0.35;
const TIKTOK_SAVE_RATE_SAT = 0.05; // 5% saves/view ⇒ max resonance
const IG_SHARE_RATE_SAT = 0.02; // 2% shares/view ⇒ max resonance
// Calibrated to the real (engagement-gated, not view-gated) data: most clips sit
// at 5K–500K views, so reach must differentiate across that band, not above 100K.
const ORGANIC_REACH_LO_LOG = 4; // 10K views ⇒ reach 0
const ORGANIC_REACH_HI_LOG = 6; // 1M views ⇒ reach 1

/** Organic traction = engagement-rate (platform metric ÷ views) blended with reach. */
function organicTraction(post: OrganicPost): number {
  const isTikTok = post.source === "tiktok";
  const primary = Math.max(0, (isTikTok ? post.bookmarks : post.shares) ?? 0);
  const views = Math.max(0, post.views ?? 0);
  const rate = views > 0 ? primary / views : 0;
  const rateScore = clamp01(rate / (isTikTok ? TIKTOK_SAVE_RATE_SAT : IG_SHARE_RATE_SAT));
  const reachScore = clamp01((Math.log10(views + 1) - ORGANIC_REACH_LO_LOG) / (ORGANIC_REACH_HI_LOG - ORGANIC_REACH_LO_LOG));
  return round4(clamp01(ORGANIC_RATE_W * rateScore + ORGANIC_REACH_W * reachScore));
}

function toNum(v: unknown, fallback = 0): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Lowercase + collapse to single-spaced, padded so single words match on word boundaries. */
function normalizeHaystack(parts: (string | null | undefined)[]): string {
  const joined = parts.filter(Boolean).join(" ").toLowerCase();
  const cleaned = joined.replace(/[^a-z0-9#\s]/g, " ").replace(/\s+/g, " ").trim();
  return ` ${cleaned} `;
}

/**
 * Weighted lexical match of keyword list against a haystack. Two-word phrases
 * must appear adjacent; one-word keywords must appear as a standalone token.
 * Returns the distinct matched keywords + the summed weight.
 */
function matchKeywords(haystack: string, keywords: string[]): { matched: string[]; weighted: number } {
  const matched: string[] = [];
  let weighted = 0;
  const seen = new Set<string>();
  for (const raw of keywords) {
    const kw = raw.toLowerCase().trim();
    if (!kw || seen.has(kw)) continue;
    seen.add(kw);
    if (haystack.includes(` ${kw} `)) {
      matched.push(kw);
      weighted += kw.includes(" ") ? PHRASE_WEIGHT : WORD_WEIGHT;
    }
  }
  return { matched, weighted };
}

function relevanceFromMatch(weighted: number): number {
  return round4(clamp01(weighted / RELEVANCE_SATURATION));
}

/** Linear recency: 1.0 today → 0 at RECENCY_WINDOW_DAYS. Null date → neutral-low. */
function recencyScore(date: Date | null | undefined): number {
  if (!date) return 0.3;
  const ageDays = (Date.now() - date.getTime()) / DAY_MS;
  return round4(clamp01(1 - ageDays / RECENCY_WINDOW_DAYS));
}

function composite(traction: number, relevance: number, recency: number, w: NicheStreamConfig["weights"]): number {
  return round4(w.traction * traction + w.relevance * relevance + w.recency * recency);
}

/**
 * Ad traction = gethookd quality score + longevity (sustained-spend proxy) +
 * scaling (variation count). Longevity/variation come from the pooled columns
 * (`runtimeDays` = days_active, `variationCount` = used_count).
 */
function adTraction(ad: AdCreative): number {
  const perf = clamp01(toNum(ad.tractionScore)); // gethookd performance_score / 100
  const longevity = clamp01((ad.runtimeDays ?? 0) / LONGEVITY_SATURATION_DAYS);
  const scale = clamp01(((ad.variationCount ?? 1) - 1) / VARIATION_SATURATION);
  return round4(clamp01(TRACTION_PERF_W * perf + TRACTION_LONGEVITY_W * longevity + TRACTION_SCALE_W * scale));
}

function resolveWeights(stream: NicheStream | null): NicheStreamConfig["weights"] {
  const cfg = (stream?.config ?? null) as Partial<NicheStreamConfig> | null;
  const w = cfg?.weights;
  if (w && typeof w.traction === "number" && typeof w.relevance === "number" && typeof w.recency === "number") {
    return w;
  }
  return DEFAULT_NICHE_CONFIG.weights;
}

export type FeedRankSummary = {
  brandId: string;
  niche: string | null;
  seeded: boolean;
  streamId: string | null;
  competitorAds: { considered: number; ranked: number };
  trendingOrganic: { considered: number; ranked: number };
};

type KeywordPools = {
  /** Flat term list for AD copy matching (ads still score on their rich copy). */
  ad: string[];
  /** The brand's own problem/outcome angle phrases (lowercased) — top relevance. */
  brandAngle: Set<string>;
  /** The niche's seed problem-language terms (lowercased) — secondary relevance. */
  niche: Set<string>;
};

/**
 * Build the brand's relevance keyword sets.
 *
 * Ads keep copy-matching (`ad` = the unified problem/outcome pool) — ad copy is
 * rich enough. Organic does NOT use captions at all; instead the ranker reads
 * the `searchQuery` that surfaced each clip and looks it up here: a clip found
 * by one of the brand's own angle phrases (`brandAngle`) is top-relevant; one
 * found by a niche seed term (`niche`) is secondary.
 */
async function buildKeywordPools(brandId: string, stream: NicheStream | null): Promise<KeywordPools> {
  const sets = await db
    .select({
      problem: schema.brandKeywordSets.problemKeywords,
      outcome: schema.brandKeywordSets.outcomeKeywords,
      status: schema.brandKeywordSets.status,
    })
    .from(schema.brandKeywordSets)
    .where(eq(schema.brandKeywordSets.brandId, brandId));

  const brandAngle = new Set<string>();
  for (const s of sets) {
    if (s.status !== "complete") continue;
    for (const k of asStringArray(s.problem)) brandAngle.add(k.toLowerCase());
    for (const k of asStringArray(s.outcome)) brandAngle.add(k.toLowerCase());
  }

  const niche = new Set<string>();
  const streamKw = (stream?.keywords ?? {}) as { organic?: unknown };
  for (const k of asStringArray(streamKw.organic)) niche.add(k.toLowerCase());
  for (const k of asStringArray(stream?.painPointKeywords)) niche.add(k.toLowerCase());

  const ad = Array.from(new Set<string>([...Array.from(brandAngle), ...Array.from(niche)]));
  return { ad, brandAngle, niche };
}

/** Upsert one feed item, refreshing scores while preserving swipe status. */
async function upsertFeedItem(row: {
  brandId: string;
  itemType: "ad" | "organic";
  adCreativeId?: string;
  organicPostId?: string;
  rail: string;
  refKey: string;
  relevance: number;
  composite: number;
  matched: string[];
}): Promise<void> {
  await db
    .insert(schema.feedItems)
    .values({
      brandId: row.brandId,
      itemType: row.itemType,
      adCreativeId: row.adCreativeId ?? null,
      organicPostId: row.organicPostId ?? null,
      rail: row.rail,
      refKey: row.refKey,
      relevanceScore: String(row.relevance),
      compositeScore: String(row.composite),
      matchedKeywords: row.matched,
    })
    .onConflictDoUpdate({
      target: [schema.feedItems.brandId, schema.feedItems.refKey],
      set: {
        relevanceScore: String(row.relevance),
        compositeScore: String(row.composite),
        matchedKeywords: row.matched,
        updatedAt: new Date(),
      },
    });
}

/**
 * Creative fingerprint for dedup. gethookd (like Meta) stores every placement /
 * refresh of the same ad as a distinct record with a UNIQUE id but IDENTICAL
 * advertiser + copy (the media URL embeds the ad id, so it's never a reliable
 * dedup key). We collapse on advertiser + normalized copy. Ads with no copy are
 * left unique (keyed by id) so we never merge unrelated blank-copy creatives.
 */
function creativeFingerprint(a: AdCreative): string {
  const copy = (a.copy ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!copy) return `uniq:${a.id}`;
  return `${(a.advertiserName ?? "").toLowerCase().trim()}|${copy}`;
}

/** Within a dedup group, prefer competitor-sourced (keeps the boost + provenance), then higher traction, then a stable id. */
function preferAd(candidate: AdCreative, current: AdCreative): boolean {
  const cc = Boolean(candidate.competitorId);
  const cu = Boolean(current.competitorId);
  if (cc !== cu) return cc;
  const tc = toNum(candidate.tractionScore);
  const tu = toNum(current.tractionScore);
  if (tc !== tu) return tc > tu;
  return candidate.id < current.id;
}

/** Ads eligible for a brand: discovered via its niche stream OR its competitors. */
async function loadEligibleAds(streamId: string | null, competitorIds: string[]): Promise<AdCreative[]> {
  const conds: SQL[] = [];
  if (streamId) conds.push(eq(schema.adCreatives.nicheStreamId, streamId));
  if (competitorIds.length > 0) conds.push(inArray(schema.adCreatives.competitorId, competitorIds));
  if (conds.length === 0) return [];
  const where = conds.length === 1 ? conds[0] : or(...conds);
  return db.select().from(schema.adCreatives).where(where);
}

/**
 * Re-rank a brand's feed: score every eligible ad + organic post against the
 * brand's keywords and upsert into `feed_items`. Returns counts per rail.
 */
export async function rankBrandFeed(brandId: string): Promise<FeedRankSummary> {
  const state = await getBrandNicheState(brandId);
  const stream = state.stream;
  const streamId = stream?.id ?? null;
  const weights = resolveWeights(stream);
  const pools = await buildKeywordPools(brandId, stream);

  // Brand overlay: this brand's competitors (any status — the ad was pulled
  // while the competitor was active; archiving shouldn't drop already-pooled ads).
  const competitorRows = await db
    .select({ id: schema.competitors.id })
    .from(schema.competitors)
    .where(eq(schema.competitors.brandId, brandId));
  const competitorIds = competitorRows.map((c) => c.id);

  // ── competitor_ads rail ──
  const allAds = await loadEligibleAds(streamId, competitorIds);

  // Collapse near-identical creatives (same advertiser + copy across many ad ids)
  // down to one representative so the rail isn't 30 copies of the same ad.
  const repByFp = new Map<string, AdCreative>();
  for (const ad of allAds) {
    const fp = creativeFingerprint(ad);
    const cur = repByFp.get(fp);
    if (!cur || preferAd(ad, cur)) repByFp.set(fp, ad);
  }
  const ads = Array.from(repByFp.values());
  const repIds = new Set(ads.map((a) => a.id));
  const collapsedIds = allAds.filter((a) => !repIds.has(a.id)).map((a) => a.id);

  // Drop not-yet-actioned feed_items for the collapsed duplicates so they vanish
  // from the rail; keep any the operator already selected/skipped.
  if (collapsedIds.length > 0) {
    await db
      .delete(schema.feedItems)
      .where(
        and(
          eq(schema.feedItems.brandId, brandId),
          eq(schema.feedItems.rail, "competitor_ads"),
          eq(schema.feedItems.status, "new"),
          inArray(schema.feedItems.adCreativeId, collapsedIds),
        ),
      );
  }

  let adsRanked = 0;
  for (const ad of ads) {
    const hay = normalizeHaystack([ad.copy, ad.advertiserName, ad.cta]);
    const { matched, weighted } = matchKeywords(hay, pools.ad);
    // Relevance from PROVENANCE, not the ad's copy: a researched competitor's ad is
    // relevant by definition; a niche ad is scored on the angle QUERY that surfaced
    // it (like the organic rail) — found by the brand's own angle phrase ⇒ top, by a
    // niche seed term ⇒ secondary, by some other query ⇒ mid. Only ads with no stored
    // query (legacy pulls) fall back to copy-matching, floored so they're not buried.
    const foundQuery = (ad.discoveryQuery ?? "").toLowerCase().trim();
    const relevance = ad.competitorId
      ? 1
      : pools.brandAngle.has(foundQuery)
        ? 1
        : pools.niche.has(foundQuery)
          ? 0.6
          : foundQuery
            ? 0.5
            : Math.max(relevanceFromMatch(weighted), RELEVANCE_FLOOR);
    const traction = adTraction(ad);
    const recency = recencyScore(ad.adStop ?? ad.adStart ?? null);
    // Hard-tier researched-competitor ads above niche-keyword ads (see boost doc).
    const comp = composite(traction, relevance, recency, weights) + (ad.competitorId ? COMPETITOR_AD_BOOST : 0);
    // Card chip shows WHY the ad is here: a niche ad shows the angle that surfaced
    // it; a competitor ad shows a "competitor" tag (the card already names the brand).
    const chips = ad.competitorId ? ["competitor"] : foundQuery ? [foundQuery] : matched;
    await upsertFeedItem({
      brandId,
      itemType: "ad",
      adCreativeId: ad.id,
      rail: "competitor_ads",
      refKey: `ad:${ad.id}`,
      relevance,
      composite: comp,
      matched: chips,
    });
    adsRanked++;
  }

  // ── trending_organic rail ──
  const allOrganic: OrganicPost[] = streamId
    ? await db.select().from(schema.organicPosts).where(eq(schema.organicPosts.nicheStreamId, streamId))
    : [];
  // Operator rule: clips must be ≥30s. Enforced at ingest for new pulls; applied
  // here too so existing sub-30s clips drop out of the rail (unknown length kept).
  const organic = allOrganic.filter((p) => p.durationSec == null || p.durationSec >= ORGANIC_MIN_DURATION_SEC);
  const tooShortIds = allOrganic.filter((p) => p.durationSec != null && p.durationSec < ORGANIC_MIN_DURATION_SEC).map((p) => p.id);
  if (tooShortIds.length > 0) {
    await db
      .delete(schema.feedItems)
      .where(
        and(
          eq(schema.feedItems.brandId, brandId),
          eq(schema.feedItems.rail, "trending_organic"),
          eq(schema.feedItems.status, "new"),
          inArray(schema.feedItems.organicPostId, tooShortIds),
        ),
      );
  }
  let organicRanked = 0;
  for (const post of organic) {
    // Relevance from PROVENANCE, never the caption: the search keyword that
    // surfaced this clip. Found by one of the brand's own angle phrases ⇒ top;
    // by a niche seed term ⇒ secondary; otherwise a small floor.
    const foundQuery = String((post.rawJson as Record<string, unknown> | null)?.searchQuery ?? "")
      .toLowerCase()
      .trim();
    const relevance = pools.brandAngle.has(foundQuery)
      ? 1
      : pools.niche.has(foundQuery)
        ? 0.5
        : foundQuery
          ? 0.4
          : 0.3;
    // Traction = engagement-RATE (saves/views for TikTok, shares/views for IG)
    // blended with reach — rewards resonance without overranking raw-big clips.
    const traction = organicTraction(post);
    const recency = recencyScore(post.postedAt ?? null);
    const comp = composite(traction, relevance, recency, ORGANIC_WEIGHTS);
    await upsertFeedItem({
      brandId,
      itemType: "organic",
      organicPostId: post.id,
      rail: "trending_organic",
      refKey: `organic:${post.id}`,
      relevance,
      composite: comp,
      matched: foundQuery ? [foundQuery] : [],
    });
    organicRanked++;
  }

  console.log(
    `[ad-console] ranked feed for ${brandId} (niche=${state.nicheType ?? "none"}): ` +
      `${adsRanked} ads, ${organicRanked} organic`,
  );

  return {
    brandId,
    niche: state.nicheType,
    seeded: state.seeded,
    streamId,
    competitorAds: { considered: allAds.length, ranked: adsRanked },
    trendingOrganic: { considered: organic.length, ranked: organicRanked },
  };
}

/** A feed item joined to whichever pooled row it references. */
export type FeedCard = {
  item: FeedItem;
  ad: AdCreative | null;
  organic: OrganicPost | null;
};

/**
 * Read a brand's ranked feed, highest composite first. Defaults to the
 * not-yet-actioned ("new") items the Console shows; pass `status` for the full
 * log. Optionally filter by `rail`.
 */
export async function listBrandFeed(
  brandId: string,
  opts?: { rail?: string; status?: string; limit?: number },
): Promise<FeedCard[]> {
  const conds: SQL[] = [eq(schema.feedItems.brandId, brandId)];
  conds.push(eq(schema.feedItems.status, opts?.status ?? "new"));
  if (opts?.rail) conds.push(eq(schema.feedItems.rail, opts.rail));

  const q = db
    .select({
      item: schema.feedItems,
      ad: schema.adCreatives,
      organic: schema.organicPosts,
    })
    .from(schema.feedItems)
    .leftJoin(schema.adCreatives, eq(schema.feedItems.adCreativeId, schema.adCreatives.id))
    .leftJoin(schema.organicPosts, eq(schema.feedItems.organicPostId, schema.organicPosts.id))
    .where(and(...conds))
    .orderBy(desc(schema.feedItems.compositeScore));

  const rows = opts?.limit ? await q.limit(opts.limit) : await q;
  return rows.map((r) => ({ item: r.item, ad: r.ad ?? null, organic: r.organic ?? null }));
}

/** Read ONE feed item (scoped to the brand) joined to its pooled row. */
export async function getFeedCard(brandId: string, feedItemId: string): Promise<FeedCard | null> {
  const [r] = await db
    .select({
      item: schema.feedItems,
      ad: schema.adCreatives,
      organic: schema.organicPosts,
    })
    .from(schema.feedItems)
    .leftJoin(schema.adCreatives, eq(schema.feedItems.adCreativeId, schema.adCreatives.id))
    .leftJoin(schema.organicPosts, eq(schema.feedItems.organicPostId, schema.organicPosts.id))
    .where(and(eq(schema.feedItems.brandId, brandId), eq(schema.feedItems.id, feedItemId)))
    .limit(1);
  if (!r) return null;
  return { item: r.item, ad: r.ad ?? null, organic: r.organic ?? null };
}

/** Flip a feed item's swipe status. Returns the updated row, or null if absent. */
export async function setFeedItemStatus(
  brandId: string,
  feedItemId: string,
  status: "new" | "selected" | "skipped",
): Promise<FeedItem | null> {
  const [row] = await db
    .update(schema.feedItems)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(schema.feedItems.brandId, brandId), eq(schema.feedItems.id, feedItemId)))
    .returning();
  return row ?? null;
}

/** Append a swipe event to the log (powers the UX + a future relevance loop). */
export async function recordFeedEvent(input: {
  brandId: string;
  feedItemId: string;
  userId: string | null;
  event: "select" | "skip" | "revise" | "view";
  metadata?: unknown;
}): Promise<void> {
  await db.insert(schema.feedEvents).values({
    brandId: input.brandId,
    feedItemId: input.feedItemId,
    userId: input.userId,
    event: input.event,
    metadata: (input.metadata ?? null) as object | null,
  });
}
