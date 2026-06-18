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
import { and, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "./db.js";
import { getBrandNicheState } from "./adConsoleNiche.js";
import { ORGANIC_MIN_DURATION_SEC, isLikelyEnglish } from "./adConsoleOrganic.js";
import { scoreAdspyTraction } from "./adspy.js";
import { DEFAULT_NICHE_CONFIG, type NicheStreamConfig } from "./nicheConfig.js";
import type { AdCreative, FeedItem, NicheStream, OrganicPost } from "../db/schema.js";

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
// 365-day decay — matches the AdSpy `seenBetween` pull window.
const RECENCY_WINDOW_DAYS = 365;
const DAY_MS = 86_400_000;

// Competitor-ad boost (added to the otherwise-0..1 composite). A soft +0.3 keeps
// the brand's researched competitors leading the rail while still letting a
// standout niche ad interleave — not a hard tier.
const COMPETITOR_AD_BOOST = 0.3;

// Operator toggle (2026-06-16): when true, the competitor_ads rail is ordered by
// SHARES alone (log-scaled traction) — highest-share creatives on top, ignoring
// relevance/recency/competitor boost. Flip to false to restore relevance-first.
const RANK_ADS_BY_SHARES_ONLY = true;

// Organic ranks 50/50 on relevance (which angle keyword SURFACED the clip — not
// its caption) and traction (engagement-RATE + reach). Recency is not used.
const ORGANIC_WEIGHTS: NicheStreamConfig["weights"] = { traction: 0.5, relevance: 0.5, recency: 0 };

// Organic traction ranks on the ABSOLUTE platform virality metric (TikTok saves /
// IG shares) on a log scale — the highest absolute share/save counts rise to the
// top. Floor at the ingest gate (100); saturate at 100K. (Tunable.)
const ORGANIC_VOL_LO_LOG = 2; // 100 saves/shares ⇒ 0
const ORGANIC_VOL_HI_LOG = 5; // 100K saves/shares ⇒ 1

/** Organic traction = ABSOLUTE platform virality volume (TikTok saves / IG shares), log-scaled. */
function organicTraction(post: OrganicPost): number {
  const isTikTok = post.source === "tiktok";
  const primary = Math.max(0, (isTikTok ? post.bookmarks : post.shares) ?? 0);
  return round4(clamp01((Math.log10(primary + 1) - ORGANIC_VOL_LO_LOG) / (ORGANIC_VOL_HI_LOG - ORGANIC_VOL_LO_LOG)));
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

// AdSpy gives real engagement, so ad traction = the canonical log-scaled share
// score (see scoreAdspyTraction in adspy.ts) — one source of truth, no drift.
function adTraction(ad: AdCreative): number {
  return round4(scoreAdspyTraction(ad.shares ?? 0));
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
  /** When set, the item enters/stays at this status — used to BURY every refresh
   *  of an ad whose fingerprint the operator already skipped. Only ever downgrades
   *  a `new` row (a CASE guard never clobbers an explicit selected/skipped). */
  status?: "skipped" | "selected";
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
      ...(row.status ? { status: row.status } : {}),
    })
    .onConflictDoUpdate({
      target: [schema.feedItems.brandId, schema.feedItems.refKey],
      set: {
        relevanceScore: String(row.relevance),
        compositeScore: String(row.composite),
        matchedKeywords: row.matched,
        updatedAt: new Date(),
        // Bury a fingerprint-skipped refresh, but never overwrite an operator's
        // explicit selected/skipped on this exact row.
        ...(row.status
          ? { status: sql`case when ${schema.feedItems.status} = 'new' then ${row.status} else ${schema.feedItems.status} end` }
          : {}),
      },
    });
}

/**
 * Creative fingerprint for dedup. AdSpy (like Meta) stores every placement /
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

/**
 * Ads eligible for a brand: discovered via its niche stream OR its competitors —
 * AND sourced from AdSpy (the sole ad source; legacy gethookd/facebook_ads rows
 * in the pool are excluded so they never rank into the feed).
 */
async function loadEligibleAds(streamId: string | null, competitorIds: string[]): Promise<AdCreative[]> {
  const provenance: SQL[] = [];
  if (streamId) provenance.push(eq(schema.adCreatives.nicheStreamId, streamId));
  if (competitorIds.length > 0) provenance.push(inArray(schema.adCreatives.competitorId, competitorIds));
  if (provenance.length === 0) return [];
  const where = and(
    eq(schema.adCreatives.source, "adspy"),
    provenance.length === 1 ? provenance[0] : or(...provenance),
  );
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

  // AdSpy is the sole ad source now — drop any not-yet-actioned competitor-rail
  // cards left over from the legacy (gethookd/facebook_ads) pool so they vanish
  // from the rail. Keep any the operator already selected/skipped.
  const legacyAdIds = (
    await db.select({ id: schema.adCreatives.id }).from(schema.adCreatives).where(ne(schema.adCreatives.source, "adspy"))
  ).map((r) => r.id);
  if (legacyAdIds.length > 0) {
    await db
      .delete(schema.feedItems)
      .where(
        and(
          eq(schema.feedItems.brandId, brandId),
          eq(schema.feedItems.rail, "competitor_ads"),
          eq(schema.feedItems.status, "new"),
          inArray(schema.feedItems.adCreativeId, legacyAdIds),
        ),
      );
  }

  // Fingerprints the operator has already SKIPPED — so EVERY refresh of that same
  // ad (a fresh AdSpy id with identical advertiser+copy) stays buried, not just the
  // exact id they swiped. Computed once from this brand's skipped ad feed_items.
  const skippedAdRows = await db
    .select({ ad: schema.adCreatives })
    .from(schema.feedItems)
    .innerJoin(schema.adCreatives, eq(schema.feedItems.adCreativeId, schema.adCreatives.id))
    .where(
      and(
        eq(schema.feedItems.brandId, brandId),
        eq(schema.feedItems.itemType, "ad"),
        eq(schema.feedItems.status, "skipped"),
      ),
    );
  const skippedFingerprints = new Set(skippedAdRows.map((r) => creativeFingerprint(r.ad)));

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
    // SHARES-ONLY mode: order purely by log-scaled shares so the most-shared
    // creatives sit on top. Otherwise: relevance-first composite + competitor boost.
    const comp = RANK_ADS_BY_SHARES_ONLY
      ? traction
      : composite(traction, relevance, recency, weights) + (ad.competitorId ? COMPETITOR_AD_BOOST : 0);
    // Card chip shows WHY the ad is here: a niche ad shows the angle that surfaced
    // it; a competitor ad shows a "competitor" tag (the card already names the brand).
    // Competitor's OWN ad (no query) → "competitor"; a name-in-copy clone (query =
    // the competitor name) → "mentions {name}"; a keyword-lane ad → its query.
    const chips = ad.competitorId
      ? foundQuery
        ? [`mentions ${foundQuery}`]
        : ["competitor"]
      : foundQuery
        ? [foundQuery]
        : matched;
    await upsertFeedItem({
      brandId,
      itemType: "ad",
      adCreativeId: ad.id,
      rail: "competitor_ads",
      refKey: `ad:${ad.id}`,
      relevance,
      composite: comp,
      matched: chips,
      status: skippedFingerprints.has(creativeFingerprint(ad)) ? "skipped" : undefined,
    });
    adsRanked++;
  }

  // ── trending_organic rail ──
  const allOrganic: OrganicPost[] = streamId
    ? await db.select().from(schema.organicPosts).where(eq(schema.organicPosts.nicheStreamId, streamId))
    : [];
  // Operator rules applied at rank too (so existing posts drop without a re-pull):
  //  - clips must be ≥30s (unknown length kept),
  //  - captions must be English (non-English dropped).
  const organic = allOrganic.filter(
    (p) => (p.durationSec == null || p.durationSec >= ORGANIC_MIN_DURATION_SEC) && isLikelyEnglish(p.caption),
  );
  const droppedIds = allOrganic
    .filter((p) => (p.durationSec != null && p.durationSec < ORGANIC_MIN_DURATION_SEC) || !isLikelyEnglish(p.caption))
    .map((p) => p.id);
  if (droppedIds.length > 0) {
    await db
      .delete(schema.feedItems)
      .where(
        and(
          eq(schema.feedItems.brandId, brandId),
          eq(schema.feedItems.rail, "trending_organic"),
          eq(schema.feedItems.status, "new"),
          inArray(schema.feedItems.organicPostId, droppedIds),
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
