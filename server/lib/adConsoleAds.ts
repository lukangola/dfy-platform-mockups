import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./db.js";
import { DEFAULT_NICHE_CONFIG, type NicheStreamConfig } from "./nicheConfig.js";
import { listCompetitors } from "./adConsoleCompetitors.js";
import { ensureBrandNiche, getBrandNicheState } from "./adConsoleNiche.js";
import { buildBrandSearchQueries, ensureBrandKeywords } from "./adConsoleKeywords.js";
import {
  getAdspyClient,
  normalizeAdspyAd,
  scoreAdspyTraction,
  adspySeenBetween,
  adMatchesCompetitor,
  AdspyAuthError,
  ADSPY_COUNTRIES,
  type AdspyAd,
  type AdspyClient,
  type NormalizedAdspyAd,
} from "./adspy.js";
import type { Competitor, NicheStream } from "../db/schema.js";

// Source literal used for every row this module writes.
const ADSPY_SOURCE = "adspy";

// Every pull is scoped to ads SEEN in the last year (drops dead creatives).
const ADSPY_SEEN_DAYS = 365;

// Per-lane page caps (AdSpy returns 10 ads/page; orderBy=total_shares front-loads
// the winners, so a couple of pages is plenty). Tunable.
const ADSPY_KEYWORD_PAGES = 2; // ~20 ads / keyword
const ADSPY_COMPETITOR_PAGES = 3; // ~30 of a verified advertiser's own ads
const ADSPY_NAMEINCOPY_PAGES = 2; // ~20 whitelisted/affiliate clones
const ADSPY_RESOLVE_PAGES = 2; // advertiser-search pages scanned to verify

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

type Provenance = { nicheStreamId?: string | null; competitorId?: string | null; discoveryQuery?: string | null };

/**
 * Upsert one ad into the global pool, keyed by (source, external_id). Provenance
 * (competitor_id / discovery_query) is FIRST-WRITER-WINS via coalesce on re-pull;
 * the volatile signals (shares, likes, active, traction) are always refreshed.
 * `traction` is pre-computed by the caller (scoreAdspyTraction over the shares).
 */
async function upsertAdCreative(
  ad: NormalizedAdspyAd,
  traction: number,
  prov: Provenance,
): Promise<"inserted" | "updated" | "skipped"> {
  const [insertedRow] = await db
    .insert(schema.adCreatives)
    .values({
      source: ADSPY_SOURCE,
      externalId: ad.externalId,
      advertiserName: ad.advertiserName ?? null,
      pageId: ad.pageId ?? null,
      // Store the deep link in both pageUrl (the brief-handoff sourceUrl) and the
      // dedicated deepLinkUrl column.
      pageUrl: ad.deepLinkUrl ?? null,
      deepLinkUrl: ad.deepLinkUrl ?? null,
      mediaUrls: ad.mediaUrls,
      thumbnailUrl: ad.thumbnailUrl ?? null,
      format: ad.format,
      copy: ad.copy ?? null,
      cta: ad.cta ?? null,
      landingUrl: ad.landingUrl ?? null,
      adStart: ad.createdOn ?? null,
      adStop: null,
      runtimeDays: null,
      isActive: ad.isActive,
      variationCount: null,
      shares: ad.shares,
      likes: ad.likes,
      tractionScore: traction.toString(),
      nicheStreamId: prov.nicheStreamId ?? null,
      competitorId: prov.competitorId ?? null,
      discoveryQuery: prov.discoveryQuery ?? null,
      rawJson: ad.rawJson,
    })
    .onConflictDoNothing({ target: [schema.adCreatives.source, schema.adCreatives.externalId] })
    .returning({ id: schema.adCreatives.id });

  if (insertedRow) return "inserted";

  await db
    .update(schema.adCreatives)
    .set({
      advertiserName: ad.advertiserName ?? null,
      pageId: ad.pageId ?? null,
      pageUrl: ad.deepLinkUrl ?? null,
      deepLinkUrl: ad.deepLinkUrl ?? null,
      mediaUrls: ad.mediaUrls,
      thumbnailUrl: ad.thumbnailUrl ?? null,
      format: ad.format,
      copy: ad.copy ?? null,
      cta: ad.cta ?? null,
      landingUrl: ad.landingUrl ?? null,
      adStart: ad.createdOn ?? null,
      isActive: ad.isActive,
      shares: ad.shares,
      likes: ad.likes,
      tractionScore: traction.toString(),
      // First-writer-wins: never clobber an existing competitor link / provenance,
      // but backfill it when a later lane is the first to attribute the ad.
      competitorId: sql`coalesce(${schema.adCreatives.competitorId}, ${prov.competitorId ?? null})`,
      discoveryQuery: sql`coalesce(${schema.adCreatives.discoveryQuery}, ${prov.discoveryQuery ?? null})`,
      rawJson: ad.rawJson,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.adCreatives.source, ADSPY_SOURCE), eq(schema.adCreatives.externalId, ad.externalId)));

  return "updated";
}

// ── Ingest orchestration ────────────────────────────────────────────────────

/** Normalize + score + upsert a batch of raw AdSpy ads, tallying outcomes. Ads with no media are skipped. */
async function ingestAds(ads: AdspyAd[], prov: Provenance, result: AdIngestResult): Promise<void> {
  for (const raw of ads) {
    result.itemsSeen++;
    const n = normalizeAdspyAd(raw);
    if (!n.mediaUrls.length) {
      result.skipped++;
      continue;
    }
    const traction = scoreAdspyTraction(n.shares);
    const outcome = await upsertAdCreative(n, traction, prov);
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
 * LANE 2 — keyword/angle discovery. Searches Ad COPY (`texts`) for the brand's
 * problem/outcome angle phrases (`brandQueries`), filled with the niche's organic
 * + pain-point terms. Scoped to US/CA/UK/AU, ordered by shares. Each ad is tagged
 * with the query that surfaced it (relevance provenance). An AdspyAuthError stops
 * the sweep gracefully (token died).
 */
export async function ingestNicheStreamAds(stream: NicheStream, brandQueries: string[] = []): Promise<AdIngestResult> {
  const client = getAdspyClient();
  const caps = resolveCaps(stream);
  const result = emptyResult();

  const kw = (stream.keywords ?? {}) as { organic?: unknown };
  const nicheOrganic = Array.isArray(kw.organic)
    ? (kw.organic as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const painPoints = Array.isArray(stream.painPointKeywords)
    ? (stream.painPointKeywords as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  const queries = dedupCI([...brandQueries, ...nicheOrganic, ...painPoints]).slice(0, caps.queriesPerPlatform);
  const sweepQueries = queries.length ? queries : stream.niche ? [stream.niche] : [];

  try {
    for (const q of sweepQueries) {
      for (let page = 1; page <= ADSPY_KEYWORD_PAGES; page++) {
        const ads = await client.searchAds({
          searches: [{ type: "texts", value: q }],
          countries: ADSPY_COUNTRIES,
          seenBetween: adspySeenBetween(ADSPY_SEEN_DAYS),
          orderBy: "total_shares",
          page,
        });
        if (!ads.length) break;
        result.queriesRun++;
        await ingestAds(ads, { nicheStreamId: stream.id, competitorId: null, discoveryQuery: q }, result);
      }
    }
  } catch (e) {
    if (e instanceof AdspyAuthError) return result;
    throw e;
  }

  return result;
}

/** Skip the name-in-copy lane for ultra-short single-word names (too noisy even with exact phrase). */
function isGenericName(name: string): boolean {
  const words = name.trim().replace(/[^a-z0-9 ]/gi, "").split(/\s+/).filter(Boolean);
  return words.length === 1 && words[0].length <= 3;
}

/**
 * Resolve a competitor to its AdSpy advertiser id (actor.userId), VERIFIED only:
 * search advertisers by name, then accept the first candidate whose ad matches
 * the competitor's fb_page_id (FB) or ig_handle (IG). Returns null when the
 * competitor has nothing to verify against, or no candidate verifies — we never
 * pull a wrong advertiser.
 */
async function resolveAdspyAdvertiser(client: AdspyClient, competitor: Competitor): Promise<string | null> {
  const hasIdentity = Boolean(competitor.fbPageId?.trim()) || Boolean(competitor.igHandle?.trim());
  if (!hasIdentity) return null;
  for (let page = 1; page <= ADSPY_RESOLVE_PAGES; page++) {
    const ads = await client.searchAds({
      searches: [{ type: "advertisers", value: competitor.name }],
      countries: ADSPY_COUNTRIES,
      seenBetween: adspySeenBetween(ADSPY_SEEN_DAYS),
      orderBy: "total_shares",
      page,
    });
    if (!ads.length) break;
    for (const raw of ads) {
      const n = normalizeAdspyAd(raw);
      if (adMatchesCompetitor(n, { fbPageId: competitor.fbPageId, igHandle: competitor.igHandle })) {
        return n.advertiserId ?? null;
      }
    }
  }
  return null;
}

/**
 * LANE 1 — one competitor's ads. (1a) The competitor's OWN ads via the verified,
 * cached AdSpy advertiser id. (1b) Whitelisted/affiliate clones via an exact-phrase
 * search of the competitor NAME in ad copy. Both are tagged with competitor_id so
 * they earn full competitor relevance + boost. An AdspyAuthError propagates to stop
 * the batch.
 */
export async function ingestCompetitorAds(
  competitor: Competitor,
  nicheStreamId: string | null,
): Promise<AdIngestResult> {
  const client = getAdspyClient();
  const result = emptyResult();

  // 1a — verified advertiser pull (resolve + cache the AdSpy advertiser id once).
  let advertiserId = competitor.adspyAdvertiserId?.trim() || null;
  if (!advertiserId) {
    advertiserId = await resolveAdspyAdvertiser(client, competitor);
    if (advertiserId) {
      await db
        .update(schema.competitors)
        .set({ adspyAdvertiserId: advertiserId, adspyVerified: true, updatedAt: new Date() })
        .where(eq(schema.competitors.id, competitor.id));
      console.log(`[ad-console] verified "${competitor.name}" → AdSpy advertiser ${advertiserId}`);
    } else {
      console.log(`[ad-console] could NOT verify "${competitor.name}" on AdSpy (no own-ad rows this pull)`);
    }
  }
  if (advertiserId) {
    for (let page = 1; page <= ADSPY_COMPETITOR_PAGES; page++) {
      const ads = await client.searchAds({
        userId: advertiserId,
        countries: ADSPY_COUNTRIES,
        seenBetween: adspySeenBetween(ADSPY_SEEN_DAYS),
        orderBy: "total_shares",
        page,
      });
      if (!ads.length) break;
      result.queriesRun++;
      await ingestAds(ads, { competitorId: competitor.id, nicheStreamId, discoveryQuery: null }, result);
    }
  }

  // 1b — competitor-name-in-copy (ungated; catches whitelisted/affiliate clones).
  if (!isGenericName(competitor.name)) {
    for (let page = 1; page <= ADSPY_NAMEINCOPY_PAGES; page++) {
      const ads = await client.searchAds({
        searches: [{ type: "texts", value: competitor.name, locked: true }],
        countries: ADSPY_COUNTRIES,
        seenBetween: adspySeenBetween(ADSPY_SEEN_DAYS),
        orderBy: "total_shares",
        page,
      });
      if (!ads.length) break;
      result.queriesRun++;
      // discoveryQuery = name → the ranker shows a "mentions {name}" chip.
      await ingestAds(ads, { competitorId: competitor.id, nicheStreamId, discoveryQuery: competitor.name }, result);
    }
  }

  return result;
}

export async function ingestBrandCompetitorAds(
  brandId: string,
  nicheStreamId: string | null,
): Promise<{ result: AdIngestResult; competitorsPulled: number }> {
  const competitors = (await listCompetitors(brandId)).filter((c) => c.status !== "archived");
  const agg = emptyResult();
  for (const c of competitors) {
    try {
      mergeResult(agg, await ingestCompetitorAds(c, nicheStreamId));
    } catch (e) {
      if (e instanceof AdspyAuthError) break;
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
 * per-scope counts. Synchronous (one AdSpy request per query) — this is the
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
    const { result, competitorsPulled: n } = await ingestBrandCompetitorAds(brandId, stream?.id ?? null);
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
