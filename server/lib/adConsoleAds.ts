/**
 * Ad Creative Console — gethookd ad ingestion + traction scoring (Phase 3).
 *
 * Pulls competitor + niche ads from the gethookd API (server/lib/gethookd.ts)
 * and writes them into the GLOBAL deduped `ad_creatives` pool (keyed by
 * source + gethookd ad id).
 *
 * The "winning ad" signal (spec §6): gethookd exposes a per-ad
 * `performance_score`, so traction is scored directly via
 * `scoreGethookdTraction` (0..1) rather than the old longevity proxy. gethookd
 * also supplies `days_active` (→ runtimeDays) and `used_count` (→
 * variationCount) directly, so those are taken from the normalized record
 * instead of being recomputed here. The per-brand relevance + composite rank
 * that turns this pool into a feed lands in Phase 5.
 *
 * Credit safety: every pull is bounded by the niche stream's `caps`
 * (adsPerQuery × queriesPerPlatform) and only ever fires from an explicit manual
 * action — never on boot or on any auto/lazy path. No gethookd credits are spent
 * until an operator clicks "pull". A 402 surfaces as CreditExhaustedError, which
 * stops the current phase gracefully.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "./db.js";
import { DEFAULT_NICHE_CONFIG, type NicheStreamConfig } from "./nicheConfig.js";
import { listCompetitors } from "./adConsoleCompetitors.js";
import { ensureBrandNiche, getBrandNicheState } from "./adConsoleNiche.js";
import { buildBrandSearchQueries, ensureBrandKeywords } from "./adConsoleKeywords.js";
import {
  getGethookdClient,
  normalizeGethookdAd,
  scoreGethookdTraction,
  CreditExhaustedError,
  type GethookdAd,
  type NormalizedGethookdAd,
} from "./gethookd.js";
import type { Competitor, NicheStream } from "../db/schema.js";

// Single market for v1 — gethookd `location` filter. US is the larger of the
// spec's US/CA target.
const DEFAULT_COUNTRY = "US";

// Source literal used for every row this module writes. Extracted here so the
// insert value and the update WHERE clause can never drift apart.
const GETHOOKD_SOURCE = "gethookd";

type Caps = NicheStreamConfig["caps"];

export type AdIngestResult = {
  queriesRun: number;
  itemsSeen: number;
  inserted: number;
  updated: number;
  skipped: number;
};

function emptyResult(): AdIngestResult {
  return { queriesRun: 0, itemsSeen: 0, inserted: 0, updated: 0, skipped: 0 };
}

function mergeResult(into: AdIngestResult, from: AdIngestResult): void {
  into.queriesRun += from.queriesRun;
  into.itemsSeen += from.itemsSeen;
  into.inserted += from.inserted;
  into.updated += from.updated;
  into.skipped += from.skipped;
}

/** Resolve per-run caps from a niche stream's live config, falling back to defaults. */
function resolveCaps(stream?: NicheStream | null): Caps {
  const cfg = (stream?.config ?? null) as Partial<NicheStreamConfig> | null;
  const caps = cfg?.caps;
  if (caps && typeof caps.adsPerQuery === "number") return caps as Caps;
  return DEFAULT_NICHE_CONFIG.caps;
}

// ── Persistence ─────────────────────────────────────────────────────────────

type Provenance = { nicheStreamId?: string | null; competitorId?: string | null };

/**
 * Upsert one ad into the global pool. Insert-or-refresh keyed by
 * (source, external_id): provenance (niche_stream_id / competitor_id) is
 * FIRST-WRITER-WINS — only set on insert, never clobbered on a later re-pull —
 * while the volatile traction signals (runtime, active, variations, score) are
 * refreshed so a still-running ad's traction tracks gethookd over time.
 *
 * `traction` is pre-computed by the caller (scoreGethookdTraction over the raw
 * gethookd ad) and passed in; `runtimeDays`/`variationCount` come straight from
 * the normalized record (gethookd supplies days_active / used_count directly).
 */
async function upsertAdCreative(
  ad: NormalizedGethookdAd,
  traction: number,
  prov: Provenance,
  caps?: Caps,
): Promise<"inserted" | "updated" | "skipped"> {
  // Eligibility (spec §7): drop ads that stopped running more than the lookback
  // window ago — stale, no longer representative of what's working now. Light
  // version of the old FB check: only applies when an inactive ad has a stop
  // date AND a caps lookback is in scope; never breaks when caps is absent.
  if (caps && ad.adStop && !ad.isActive) {
    const sinceStopDays = (Date.now() - ad.adStop.getTime()) / 86_400_000;
    if (sinceStopDays > caps.adLookbackDays) return "skipped";
  }

  // gethookd supplies days_active directly → use it; do NOT recompute. used_count
  // is meaningful (may be 0/undefined), so we store it as-is (no Math.max(1,…)
  // floor the FB path applied) — a real 0 is signal, not a default.
  const runtimeDays = ad.runtimeDays ?? null;
  const variationCount = ad.variationCount ?? 0;

  const [insertedRow] = await db
    .insert(schema.adCreatives)
    .values({
      source: GETHOOKD_SOURCE,
      externalId: ad.externalId,
      advertiserName: ad.advertiserName ?? null,
      pageId: ad.pageId ?? null,
      pageUrl: ad.pageUrl ?? null,
      mediaUrls: ad.mediaUrls,
      thumbnailUrl: ad.thumbnailUrl ?? null,
      format: ad.format,
      copy: ad.copy ?? null,
      cta: ad.cta ?? null,
      landingUrl: ad.landingUrl ?? null,
      adStart: ad.adStart ?? null,
      adStop: ad.adStop ?? null,
      runtimeDays,
      isActive: ad.isActive,
      variationCount,
      tractionScore: traction.toString(),
      nicheStreamId: prov.nicheStreamId ?? null,
      competitorId: prov.competitorId ?? null,
      rawJson: ad.rawJson,
    })
    .onConflictDoNothing({ target: [schema.adCreatives.source, schema.adCreatives.externalId] })
    .returning({ id: schema.adCreatives.id });

  if (insertedRow) return "inserted";

  // Already pooled — refresh the volatile signals, preserve provenance.
  await db
    .update(schema.adCreatives)
    .set({
      advertiserName: ad.advertiserName ?? null,
      pageId: ad.pageId ?? null,
      pageUrl: ad.pageUrl ?? null,
      mediaUrls: ad.mediaUrls,
      thumbnailUrl: ad.thumbnailUrl ?? null,
      format: ad.format,
      copy: ad.copy ?? null,
      cta: ad.cta ?? null,
      landingUrl: ad.landingUrl ?? null,
      adStart: ad.adStart ?? null,
      adStop: ad.adStop ?? null,
      runtimeDays,
      isActive: ad.isActive,
      variationCount,
      tractionScore: traction.toString(),
      rawJson: ad.rawJson,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.adCreatives.source, GETHOOKD_SOURCE), eq(schema.adCreatives.externalId, ad.externalId)));

  return "updated";
}

// ── Ingest orchestration ────────────────────────────────────────────────────

/**
 * Normalize + score + upsert a batch of raw gethookd ads, tallying outcomes into
 * `result` (same inserted/updated/skipped scheme the old per-URL loop used). Ads
 * with no usable media are skipped before any DB write.
 */
async function ingestAds(ads: GethookdAd[], prov: Provenance, caps: Caps, result: AdIngestResult): Promise<void> {
  for (const raw of ads) {
    result.itemsSeen++;
    const n = normalizeGethookdAd(raw);
    if (!n.mediaUrls.length) {
      result.skipped++;
      continue;
    }
    const traction = scoreGethookdTraction(raw);
    const outcome = await upsertAdCreative(n, traction, prov, caps);
    if (outcome === "inserted") result.inserted++;
    else if (outcome === "updated") result.updated++;
    else result.skipped++;
  }
}

/** Case-insensitive de-dup, preserving first occurrence. */
function dedupCI(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

/**
 * Pull the niche stream's ads from gethookd. Two phases, both tagged to the niche
 * stream:
 *
 *  1. BREADTH via /explore — the brand's PROBLEM/OUTCOME angle phrases
 *     (`brandQueries`) drive the query, the same pool the organic rail searches.
 *     We deliberately key on the problem/symptom language (not product/category)
 *     to surface the organic-feeling, hook-led ads we want to mirror, filtered to
 *     winning/scaling performance and the caps lookback window. The niche's
 *     organic + pain-point terms fill any remaining query slots.
 *  2. AUTO-LEADER core — the niche's top brands by active-ad count (free
 *     /brands-by-category) are added to BrandSpy and their top ads pulled.
 *
 * The niche→gethookd category mapping is an open item: `stream.niche` is passed
 * straight through as the gethookd `niche` (no invented mapping). A 402 anywhere
 * stops the offending phase gracefully (CreditExhaustedError).
 */
export async function ingestNicheStreamAds(stream: NicheStream, brandQueries: string[] = []): Promise<AdIngestResult> {
  const client = getGethookdClient();
  const caps = resolveCaps(stream);
  const result = emptyResult();

  const kw = (stream.keywords ?? {}) as { organic?: unknown };
  const nicheOrganic = Array.isArray(kw.organic)
    ? (kw.organic as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const painPoints = Array.isArray(stream.painPointKeywords)
    ? (stream.painPointKeywords as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  // Brand angle (problem/outcome) phrases first, then niche problem-language fill.
  const queries = dedupCI([...brandQueries, ...nicheOrganic, ...painPoints]).slice(0, caps.queriesPerPlatform);
  const lookbackFrom = new Date(Date.now() - (caps.adLookbackDays ?? 365) * 86_400_000).toISOString();

  // Phase 1: breadth via /explore. When there are no brand/niche phrases, run one
  // niche-only sweep (query undefined).
  const prov: Provenance = { nicheStreamId: stream.id, competitorId: null };
  try {
    for (const q of queries.length ? queries : [undefined]) {
      const res = await client.explore({
        niche: stream.niche,
        query: q,
        location: DEFAULT_COUNTRY,
        performanceScores: ["winning", "scaling"],
        perPage: caps.adsPerQuery,
        startDateFrom: lookbackFrom,
      });
      result.queriesRun++;
      await ingestAds(res.data, prov, caps, result);
    }
  } catch (e) {
    if (!(e instanceof CreditExhaustedError)) throw e;
    // Credits exhausted mid-breadth — stop here, return what we got.
    return result;
  }

  // Phase 2: auto-leader core (free brands-by-category → ensure BrandSpy →
  // top-ads). Per-leader try/catch so one BrandSpy plan cap / 500 doesn't abort
  // the phase; a 402 stops the leader phase entirely.
  try {
    const leaders = await client.brandsByCategory(stream.niche, 10);
    for (const leader of leaders.data) {
      try {
        await client.addBrandSpy(leader.external_id); // may THROW on a BrandSpy plan cap
        const top = await client.brandTopAds(leader.external_id, 10);
        result.queriesRun++;
        await ingestAds(top.data, prov, caps, result);
      } catch (e) {
        if (e instanceof CreditExhaustedError) break;
        // else: skip this leader (plan cap / transient), continue with the next.
        console.warn(`[ad-console] niche leader "${leader.name}" skipped:`, e);
      }
    }
  } catch (e) {
    if (e instanceof CreditExhaustedError) {
      console.warn(`[ad-console] niche-leader phase stopped early — gethookd credits exhausted`);
    } else {
      // Non-credit failure of the (free) category lookup — log and move on; the
      // breadth phase already produced results.
      console.warn(`[ad-console] niche-leader phase failed for "${stream.niche}":`, e);
    }
  }

  return result;
}

/**
 * Pull one competitor's ads from gethookd. Resolves (and caches) the gethookd
 * brand id from the competitor's name on first use, ensures the brand is in
 * BrandSpy, then pulls its top ads. Best-effort: skips cleanly when the brand
 * can't be resolved; a 402 propagates so the caller can stop the batch.
 */
export async function ingestCompetitorAds(competitor: Competitor, nicheStreamId: string | null, caps: Caps): Promise<AdIngestResult> {
  const client = getGethookdClient();
  const result = emptyResult();

  // Resolve + cache the gethookd brand id from the competitor's name.
  let brandId = competitor.gethookdBrandId?.trim() || null;
  if (!brandId) {
    const { data } = await client.searchBrands(competitor.name);
    const match = data.find((b) => b.name.toLowerCase() === competitor.name.toLowerCase()) ?? data[0];
    if (!match) {
      console.log(`[ad-console] no gethookd brand matched competitor "${competitor.name}"`);
      return result;
    }
    brandId = match.external_id;
    await db
      .update(schema.competitors)
      .set({ gethookdBrandId: brandId, updatedAt: new Date() })
      .where(eq(schema.competitors.id, competitor.id));
    console.log(`[ad-console] resolved "${competitor.name}" → gethookd brand_id=${brandId} ("${match.name}")`);
  }

  // Ensure the brand is monitored (BrandSpy). A 402 must stop the batch; any
  // other failure (e.g. plan cap) shouldn't block trying top-ads.
  if (!competitor.brandspyActive) {
    try {
      const ok = await client.addBrandSpy(brandId);
      await db
        .update(schema.competitors)
        .set({ brandspyActive: ok, updatedAt: new Date() })
        .where(eq(schema.competitors.id, competitor.id));
    } catch (e) {
      if (e instanceof CreditExhaustedError) throw e;
      console.warn(`[ad-console] BrandSpy add failed for "${competitor.name}" (trying top-ads anyway):`, e);
    }
  }

  const top = await client.brandTopAds(brandId, 20);
  result.queriesRun++;
  await ingestAds(top.data, { competitorId: competitor.id, nicheStreamId }, caps, result);
  return result;
}

/**
 * Pull every active (non-archived) competitor for a brand. Best-effort per
 * competitor: one competitor failing (e.g. gethookd 500 / unresolvable brand)
 * shouldn't abort the batch — it's logged and skipped. A CreditExhaustedError
 * (402) DOES stop the batch, since further pulls would only fail the same way.
 */
export async function ingestBrandCompetitorAds(
  brandId: string,
  nicheStreamId: string | null,
  caps: Caps,
): Promise<{ result: AdIngestResult; competitorsPulled: number }> {
  const competitors = (await listCompetitors(brandId)).filter((c) => c.status !== "archived");
  const agg = emptyResult();
  for (const c of competitors) {
    try {
      mergeResult(agg, await ingestCompetitorAds(c, nicheStreamId, caps));
    } catch (e) {
      if (e instanceof CreditExhaustedError) break;
      console.error(`[ad-console] competitor ad pull failed for "${c.name}":`, e);
    }
  }
  return { result: agg, competitorsPulled: competitors.length };
}

export type BrandAdIngestSummary = {
  niche: string | null;
  seeded: boolean;
  nicheAds: AdIngestResult | null;
  competitorAds: AdIngestResult | null;
  competitorsPulled: number;
};

/**
 * Brand-level manual pull. Ingests the brand's niche-stream ads (when the niche
 * is a seeded stream) and its competitors' ads into the shared pool, returning
 * per-scope counts. Synchronous (one gethookd request per query) — this is the
 * explicit, operator-triggered Phase-3 path; the weekly async orchestration lands in a
 * later phase. Throws PromptNotConfiguredError / "no products" up to the route
 * (→ 424) when niche detection can't run for a niche-scoped pull.
 */
export async function ingestBrandAds(brandId: string, scope: "niche" | "competitors" | "all" = "all"): Promise<BrandAdIngestSummary> {
  const wantNiche = scope === "all" || scope === "niche";
  const wantCompetitors = scope === "all" || scope === "competitors";

  let niche: string | null = null;
  let seeded = false;
  let stream: NicheStream | null = null;
  let nicheAds: AdIngestResult | null = null;
  let competitorAds: AdIngestResult | null = null;
  let competitorsPulled = 0;

  if (wantNiche) {
    // Forces detection if the brand isn't classified yet (needs products).
    const state = await ensureBrandNiche(brandId);
    niche = state.nicheType;
    seeded = state.seeded;
    stream = state.stream;
    if (stream) {
      // Unified search: the brand's PROBLEM/OUTCOME angle phrases drive the
      // ad-library search too (same pool as organic) — we mirror pure organic
      // problem/symptom language rather than product/category keywords.
      await ensureBrandKeywords(brandId);
      const { organicQueries } = await buildBrandSearchQueries(brandId);
      nicheAds = await ingestNicheStreamAds(stream, organicQueries);
    }
  } else {
    // Competitors-only: surface the current niche state without forcing detection.
    const state = await getBrandNicheState(brandId);
    niche = state.nicheType;
    seeded = state.seeded;
    stream = state.stream;
  }

  if (wantCompetitors) {
    const { result, competitorsPulled: n } = await ingestBrandCompetitorAds(brandId, stream?.id ?? null, resolveCaps(stream));
    competitorAds = result;
    competitorsPulled = n;
  }

  console.log(
    `[ad-console] brand ${brandId} ad ingest (scope=${scope}): ` +
      `niche=${nicheAds ? `${nicheAds.inserted}+/${nicheAds.updated}~` : "—"} ` +
      `competitors=${competitorAds ? `${competitorAds.inserted}+/${competitorAds.updated}~ over ${competitorsPulled}` : "—"}`,
  );

  return { niche, seeded, nicheAds, competitorAds, competitorsPulled };
}
