/**
 * Ad Creative Console — Facebook Ad Library ingestion + longevity scoring (Phase 3).
 *
 * Pulls competitor + niche ads from Meta's public Ad Library via Apify's
 * `curious_coder/facebook-ads-library-scraper` actor and writes them into the
 * GLOBAL deduped `ad_creatives` pool (keyed by source + Meta ad_archive_id).
 *
 * The "winning ad" signal (spec §6): there is NO public US/CA ad-impression data,
 * so we proxy traction by LONGEVITY — advertisers kill losing creatives fast, so
 * an ad that's been running for months (and/or has many active variations) is a
 * proven performer. `scoreAdLongevity` turns runtime_days + variation_count +
 * still-active into an intrinsic 0..1 `tractionScore`. The per-brand relevance +
 * composite rank that turns this pool into a feed lands in Phase 5.
 *
 * Credit safety: every pull is bounded by the niche stream's `caps`
 * (adsPerQuery × queriesPerPlatform) and only ever fires from an explicit manual
 * action — never on boot or on any auto/lazy path. No Apify credits are spent
 * until an operator clicks "pull".
 *
 * We call Apify's REST run-sync endpoint directly (no SDK), mirroring
 * server/lib/apify.ts. Actor OUTPUT field names drift between versions, so every
 * field is read defensively from a set of likely candidates, and the first raw
 * item's keys are logged once per query so the mapping can be confirmed against
 * live data during dev testing.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "./db.js";
import { env } from "./env.js";
import { DEFAULT_NICHE_CONFIG, type NicheStreamConfig } from "./nicheConfig.js";
import { listCompetitors } from "./adConsoleCompetitors.js";
import { ensureBrandNiche, getBrandNicheState } from "./adConsoleNiche.js";
import { buildBrandSearchQueries, ensureBrandKeywords } from "./adConsoleKeywords.js";
import type { Competitor, NicheStream } from "../db/schema.js";

// curious_coder/facebook-ads-library-scraper — actor id XtaWFhbtfxyzqrFmd.
// Path form uses ~ instead of / (same convention as apify.ts reddit actor).
const FB_ADS_ACTOR = "curious_coder~facebook-ads-library-scraper";
const FB_ADS_RUN_SYNC = `https://api.apify.com/v2/acts/${FB_ADS_ACTOR}/run-sync-get-dataset-items`;

// Single market for v1. Meta's Ad Library country filter is one country per
// search URL; US is the larger of the spec's US/CA target.
const DEFAULT_COUNTRY = "US";

const FB_ADS_LIBRARY_BASE = "https://www.facebook.com/ads/library/";

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

// ── Apify transport ─────────────────────────────────────────────────────────

/** A Meta Ad Library KEYWORD search URL (broad niche anchors + advertiser names). */
function keywordSearchUrl(query: string, country: string): string {
  const p = new URLSearchParams({
    active_status: "all",
    ad_type: "all",
    country,
    q: query,
    search_type: "keyword_unordered",
    media_type: "all",
  });
  return `${FB_ADS_LIBRARY_BASE}?${p.toString()}`;
}

/** A Meta Ad Library PAGE search URL — every active ad for one advertiser page. */
function pageSearchUrl(pageId: string, country: string): string {
  const p = new URLSearchParams({
    active_status: "all",
    ad_type: "all",
    country,
    view_all_page_id: pageId,
    search_type: "page",
    media_type: "all",
  });
  return `${FB_ADS_LIBRARY_BASE}?${p.toString()}`;
}


/** One actor run-sync POST. Throws on non-2xx (caller decides whether to retry). */
async function postFbAdsRun(url: string, count: number, timeoutMs: number): Promise<Record<string, unknown>[]> {
  if (!env.APIFY_TOKEN) throw new Error("APIFY_TOKEN not set");
  const input = {
    urls: [{ url, method: "GET" }],
    count,
    "scrapePageAds.activeStatus": "all",
    scrapeAdDetails: true,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${FB_ADS_RUN_SYNC}?token=${encodeURIComponent(env.APIFY_TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`Apify FB ad run failed (${res.status}): ${detail.slice(0, 300)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  const items = (await res.json()) as unknown;
  if (!Array.isArray(items)) throw new Error("Apify FB ad run returned a non-array dataset");
  return items as Record<string, unknown>[];
}

/**
 * Run the FB Ad Library actor for one search URL. Apify's run-sync endpoint
 * occasionally 502/503/504s under load, so transient 5xx + network errors get a
 * couple of backed-off retries; a 4xx (bad input) fails fast.
 */
async function fetchFbAdsForUrl(url: string, count: number, timeoutMs = 180_000): Promise<Record<string, unknown>[]> {
  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await postFbAdsRun(url, count, timeoutMs);
    } catch (err) {
      lastErr = err;
      const status = (err as Error & { status?: number }).status;
      const isTransient = status === undefined || status >= 500; // network error or 5xx
      if (!isTransient || attempt === maxAttempts) throw err;
      const backoffMs = 2000 * attempt;
      console.warn(`[ad-console] Apify run transient failure (attempt ${attempt}/${maxAttempts}, status=${status ?? "net"}); retrying in ${backoffMs}ms`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

// ── Defensive field extraction ──────────────────────────────────────────────

function pickStr(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function pickNum(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  }
  return null;
}

function pickBool(obj: Record<string, unknown>, keys: string[]): boolean | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const lc = v.trim().toLowerCase();
      if (lc === "true" || lc === "active") return true;
      if (lc === "false" || lc === "inactive") return false;
    }
  }
  return null;
}

/** Parse a Meta date that may arrive as unix seconds, unix ms, or an ISO string. */
function parseAdDate(v: unknown): Date | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v; // <1e12 ⇒ seconds
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string" && v.trim()) {
    const s = v.trim();
    if (/^\d+$/.test(s)) return parseAdDate(Number(s));
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isHttpUrl(v: unknown): v is string {
  return typeof v === "string" && /^https?:\/\//i.test(v);
}

type NormalizedFbAd = {
  externalId: string;
  advertiserName: string | null;
  pageId: string | null;
  pageUrl: string | null;
  mediaUrls: string[];
  thumbnailUrl: string | null;
  format: "video" | "static";
  copy: string | null;
  cta: string | null;
  landingUrl: string | null;
  adStart: Date | null;
  adStop: Date | null;
  isActive: boolean | null;
  variationCount: number;
  raw: Record<string, unknown>;
};

/** Pull the primary ad text out of snapshot.body, which may be a string or { text }. */
function extractBody(snap: Record<string, unknown>): string | null {
  const b = snap.body;
  if (typeof b === "string" && b.trim()) return b.trim();
  if (b && typeof b === "object") {
    const t = (b as Record<string, unknown>).text;
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  return null;
}

/** Collect every creative media URL + a thumbnail from a snapshot's images/videos/cards. */
function collectMedia(snap: Record<string, unknown>): { media: string[]; thumbnail: string | null; hasVideo: boolean } {
  const media: string[] = [];
  let thumbnail: string | null = null;
  let hasVideo = false;
  const push = (u: unknown) => {
    if (isHttpUrl(u) && !media.includes(u)) media.push(u);
  };
  const asArray = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];

  for (const img of asArray(snap.images)) {
    push(img.original_image_url ?? img.resized_image_url ?? img.url);
    if (!thumbnail) thumbnail = pickStr(img, ["resized_image_url", "original_image_url", "url"]) || null;
  }
  for (const v of asArray(snap.videos)) {
    hasVideo = true;
    push(v.video_hd_url ?? v.video_sd_url ?? v.url);
    const preview = pickStr(v, ["video_preview_image_url", "preview_image_url", "thumbnail_url"]);
    if (preview) {
      push(preview);
      if (!thumbnail) thumbnail = preview;
    }
  }
  for (const c of asArray(snap.cards)) {
    const cv = c.video_hd_url ?? c.video_sd_url;
    if (cv) {
      hasVideo = true;
      push(cv);
    }
    push(c.original_image_url ?? c.resized_image_url ?? c.image_url);
    const preview = pickStr(c, ["video_preview_image_url", "resized_image_url", "original_image_url"]);
    if (preview && !thumbnail) thumbnail = preview;
  }
  return { media, thumbnail, hasVideo };
}

/** Map one raw Apify item to our ad shape. Returns null when it lacks an id. */
function normalizeFbAd(raw: Record<string, unknown>): NormalizedFbAd | null {
  const snap = (raw.snapshot && typeof raw.snapshot === "object" ? raw.snapshot : {}) as Record<string, unknown>;

  const externalId = pickStr(raw, ["ad_archive_id", "adArchiveID", "adArchiveId", "ad_archive_ID", "id"]);
  if (!externalId) return null;

  const advertiserName =
    pickStr(raw, ["page_name", "pageName"]) || pickStr(snap, ["page_name", "current_page_name"]) || null;
  const pageId = pickStr(raw, ["page_id", "pageId"]) || pickStr(snap, ["page_id"]) || null;
  const pageUrl =
    pickStr(raw, ["page_profile_uri", "pageUrl"]) ||
    pickStr(snap, ["page_profile_uri"]) ||
    (pageId ? `https://www.facebook.com/${pageId}` : "") ||
    null;

  const { media, thumbnail, hasVideo } = collectMedia(snap);

  const adStart = parseAdDate(
    raw.start_date ?? raw.startDate ?? raw.ad_delivery_start_time ?? snap.start_date ?? snap.startDate,
  );
  const adStop = parseAdDate(
    raw.end_date ?? raw.endDate ?? raw.ad_delivery_stop_time ?? snap.end_date ?? snap.endDate,
  );

  let isActive = pickBool(raw, ["is_active", "isActive", "active"]);
  if (isActive === null) {
    // Infer when the actor doesn't say: an ad with no stop date, or a stop date
    // in the future, is still running.
    isActive = !adStop || adStop.getTime() > Date.now();
  }

  const variationCount = pickNum(raw, ["collation_count", "collationCount", "total", "reach_estimate"]) ?? 1;

  return {
    externalId,
    advertiserName,
    pageId,
    pageUrl,
    mediaUrls: media,
    thumbnailUrl: thumbnail,
    format: hasVideo ? "video" : "static",
    copy: extractBody(snap) ?? (pickStr(raw, ["ad_creative_body", "body"]) || null),
    cta: pickStr(snap, ["cta_text", "cta_type"]) || pickStr(raw, ["cta_text"]) || null,
    landingUrl: pickStr(snap, ["link_url", "caption"]) || pickStr(raw, ["link_url"]) || null,
    adStart,
    adStop,
    isActive,
    variationCount: Math.max(1, variationCount),
    raw,
  };
}

// ── Longevity scoring ───────────────────────────────────────────────────────

/** (adStop ?? today) − adStart, in whole days, clipped to [0, adLookbackDays]. */
function computeRuntimeDays(adStart: Date | null, adStop: Date | null, lookback: number): number {
  if (!adStart) return 0;
  const end = adStop ?? new Date();
  const days = Math.floor((end.getTime() - adStart.getTime()) / 86_400_000);
  return Math.max(0, Math.min(days, lookback));
}

/**
 * Intrinsic 0..1 traction proxy. Longevity dominates (an ad that survives is a
 * proven winner); many grouped variations corroborate (winners get re-cut); a
 * still-active flag is a small recency-of-proof nudge. Both ad and organic
 * traction are normalized to 0..1 so the Phase-5 composite can blend them.
 */
function scoreAdLongevity(input: { runtimeDays: number; isActive: boolean | null; variationCount: number }, caps: Caps): number {
  const lookback = caps.adLookbackDays || 365;
  const runtimeScore = Math.max(0, Math.min(input.runtimeDays, lookback)) / lookback; // 0..1
  const variationScore = Math.min(Math.max(0, input.variationCount) / 10, 1); // 0..1, saturates at 10
  const active = input.isActive ? 1 : 0;
  const score = 0.7 * runtimeScore + 0.2 * variationScore + 0.1 * active;
  return Math.round(Math.max(0, Math.min(score, 1)) * 10_000) / 10_000; // 4dp
}

// ── Persistence ─────────────────────────────────────────────────────────────

type Provenance = { nicheStreamId?: string | null; competitorId?: string | null };

/**
 * Upsert one ad into the global pool. Insert-or-refresh keyed by
 * (source, external_id): provenance (niche_stream_id / competitor_id) is
 * FIRST-WRITER-WINS — only set on insert, never clobbered on a later re-pull —
 * while the volatile longevity signals (runtime, active, variations, score) are
 * refreshed so a still-running ad's traction climbs over time.
 */
async function upsertAdCreative(ad: NormalizedFbAd, prov: Provenance, caps: Caps): Promise<"inserted" | "updated" | "skipped"> {
  const runtimeDays = computeRuntimeDays(ad.adStart, ad.adStop, caps.adLookbackDays);

  // Eligibility (spec §7): drop ads that stopped running more than the lookback
  // window ago — stale, no longer representative of what's working now.
  if (ad.adStop && ad.isActive !== true) {
    const sinceStopDays = (Date.now() - ad.adStop.getTime()) / 86_400_000;
    if (sinceStopDays > caps.adLookbackDays) return "skipped";
  }

  const tractionScore = scoreAdLongevity({ runtimeDays, isActive: ad.isActive, variationCount: ad.variationCount }, caps);

  const [insertedRow] = await db
    .insert(schema.adCreatives)
    .values({
      source: "facebook_ads",
      externalId: ad.externalId,
      advertiserName: ad.advertiserName,
      pageId: ad.pageId,
      pageUrl: ad.pageUrl,
      mediaUrls: ad.mediaUrls,
      thumbnailUrl: ad.thumbnailUrl,
      format: ad.format,
      copy: ad.copy,
      cta: ad.cta,
      landingUrl: ad.landingUrl,
      adStart: ad.adStart,
      adStop: ad.adStop,
      runtimeDays,
      isActive: ad.isActive,
      variationCount: ad.variationCount,
      tractionScore: String(tractionScore),
      nicheStreamId: prov.nicheStreamId ?? null,
      competitorId: prov.competitorId ?? null,
      rawJson: ad.raw,
    })
    .onConflictDoNothing({ target: [schema.adCreatives.source, schema.adCreatives.externalId] })
    .returning({ id: schema.adCreatives.id });

  if (insertedRow) return "inserted";

  // Already pooled — refresh the volatile signals, preserve provenance.
  await db
    .update(schema.adCreatives)
    .set({
      advertiserName: ad.advertiserName,
      pageId: ad.pageId,
      pageUrl: ad.pageUrl,
      mediaUrls: ad.mediaUrls,
      thumbnailUrl: ad.thumbnailUrl,
      format: ad.format,
      copy: ad.copy,
      cta: ad.cta,
      landingUrl: ad.landingUrl,
      adStart: ad.adStart,
      adStop: ad.adStop,
      runtimeDays,
      isActive: ad.isActive,
      variationCount: ad.variationCount,
      tractionScore: String(tractionScore),
      rawJson: ad.raw,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.adCreatives.source, "facebook_ads"), eq(schema.adCreatives.externalId, ad.externalId)));

  return "updated";
}

// ── Ingest orchestration ────────────────────────────────────────────────────

/** Run a set of search URLs sequentially, normalizing + upserting every ad. */
async function ingestFromUrls(urls: string[], count: number, prov: Provenance, caps: Caps): Promise<AdIngestResult> {
  const result = emptyResult();
  for (const url of urls) {
    let items: Record<string, unknown>[];
    try {
      items = await fetchFbAdsForUrl(url, count);
    } catch (err) {
      // One bad query shouldn't abort the whole pull — log and move on.
      console.error(`[ad-console] FB ad pull failed for ${url.slice(0, 100)}:`, err);
      continue;
    }
    result.queriesRun++;
    if (items.length > 0) {
      // One-time shape visibility, so the defensive field mapping above can be
      // confirmed/tightened against live actor output during dev testing.
      console.log(
        `[ad-console] FB ads: ${items.length} raw items for "${url.slice(0, 80)}"; first item keys=[${Object.keys(items[0]).join(",")}]`,
      );
    }
    for (const raw of items) {
      result.itemsSeen++;
      const ad = normalizeFbAd(raw);
      if (!ad) {
        result.skipped++;
        continue;
      }
      const outcome = await upsertAdCreative(ad, prov, caps);
      if (outcome === "inserted") result.inserted++;
      else if (outcome === "updated") result.updated++;
      else result.skipped++;
    }
  }
  return result;
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
 * Pull the niche stream's ads using the brand's PROBLEM/OUTCOME angle phrases
 * (`brandQueries`) — the same pool the organic rail searches. We deliberately
 * do NOT search product/category keywords here: those surface salesy, product-
 * led ads, whereas matching the problem/symptom language finds the organic-
 * feeling, hook-led ads we want to mirror. The niche's organic + pain-point
 * terms fill any remaining slots. Tags every find with the niche stream.
 */
export async function ingestNicheStreamAds(stream: NicheStream, brandQueries: string[] = []): Promise<AdIngestResult> {
  const caps = resolveCaps(stream);
  const kw = (stream.keywords ?? {}) as { organic?: unknown };
  const nicheOrganic = Array.isArray(kw.organic)
    ? (kw.organic as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const painPoints = Array.isArray(stream.painPointKeywords)
    ? (stream.painPointKeywords as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  // Brand angle (problem/outcome) phrases first, then niche problem-language fill.
  const queries = dedupCI([...brandQueries, ...nicheOrganic, ...painPoints]).slice(0, caps.queriesPerPlatform);
  const urls = queries.map((q) => keywordSearchUrl(q, DEFAULT_COUNTRY));
  return ingestFromUrls(urls, caps.adsPerQuery, { nicheStreamId: stream.id }, caps);
}

// ── Competitor advertising-page resolution ──────────────────────────────────
//
// A brand's vanity FB URL (facebook.com/<slug>) resolves to its PROFILE id
// (fb://profile/<id>) — which is NOT the id its ads run under. Meta's Ad Library
// keys ads by a separate ADVERTISING page id. Empirically (MUD\WTR): profile id
// 100043472975768, advertising id 172538983355501 — a page search on the profile
// id returns ADS_NOT_FOUND. So we resolve the real advertising id by keyword-
// searching the competitor's name and matching the returned advertiser whose page
// name equals the competitor, then page-search that id for the complete ad set.

/** Ads to scan when resolving a competitor's advertising page id from a name search. */
const FB_RESOLVE_COUNT = 30;

/** lowercase + strip everything non-alphanumeric, for fuzzy advertiser-name matching. */
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type PageTally = { pageId: string; pageName: string; count: number };

/** Tally distinct advertising pages (id + name + ad count) across raw ad items. */
function tallyPages(items: Record<string, unknown>[]): PageTally[] {
  const map = new Map<string, PageTally>();
  for (const r of items) {
    const snap = (r.snapshot && typeof r.snapshot === "object" ? r.snapshot : {}) as Record<string, unknown>;
    const pageId = pickStr(r, ["page_id", "pageId"]) || pickStr(snap, ["page_id"]);
    if (!pageId) continue;
    const pageName = pickStr(r, ["page_name", "pageName"]) || pickStr(snap, ["page_name", "current_page_name"]);
    const cur = map.get(pageId) ?? { pageId, pageName, count: 0 };
    if (!cur.pageName && pageName) cur.pageName = pageName;
    cur.count++;
    map.set(pageId, cur);
  }
  return Array.from(map.values());
}

/**
 * Pick the advertising page whose name best matches the competitor: exact
 * normalized match first, else a substring match either way (with a length guard
 * so "om" doesn't swallow everything), breaking ties by ad count. Returns null
 * when nothing recognizable matches — the competitor isn't advertising under their
 * own page name, so we'd rather pull nothing than reseller/affiliate noise.
 */
function bestPageMatch(competitorName: string, pages: PageTally[]): PageTally | null {
  const target = normName(competitorName);
  if (target.length < 2) return null;
  const exact = pages.filter((p) => normName(p.pageName) === target).sort((a, b) => b.count - a.count);
  if (exact.length) return exact[0];
  const partial = pages
    .filter((p) => {
      const n = normName(p.pageName);
      if (n.length < 3 || target.length < 3) return false;
      return n.includes(target) || target.includes(n);
    })
    .sort((a, b) => b.count - a.count);
  return partial[0] ?? null;
}

/**
 * Resolve + cache a competitor's FB Ad Library ADVERTISING page id. Keyword-
 * searches their name, matches the returned advertiser page, and writes the id
 * back onto the competitor row so subsequent pulls skip this step. Returns null
 * when the competitor isn't advertising under a recognizable page name.
 */
async function resolveCompetitorPageId(competitor: Competitor, caps: Caps): Promise<string | null> {
  const url = keywordSearchUrl(competitor.name, DEFAULT_COUNTRY);
  let items: Record<string, unknown>[];
  try {
    items = await fetchFbAdsForUrl(url, Math.min(FB_RESOLVE_COUNT, caps.adsPerQuery));
  } catch (err) {
    console.error(`[ad-console] page-id resolve failed for "${competitor.name}":`, err);
    return null;
  }
  // Actor surfaces "no ads"/"page not supported" as a single error item.
  if (items.length === 1 && (items[0].error || items[0].errorCode)) return null;

  const match = bestPageMatch(competitor.name, tallyPages(items));
  if (!match) {
    console.log(`[ad-console] no advertising page matched competitor "${competitor.name}"`);
    return null;
  }
  await db
    .update(schema.competitors)
    .set({ fbPageId: match.pageId, updatedAt: new Date() })
    .where(eq(schema.competitors.id, competitor.id));
  console.log(`[ad-console] resolved "${competitor.name}" → page_id=${match.pageId} ("${match.pageName}")`);
  return match.pageId;
}

/**
 * Pull one competitor's ads from their real Ad Library. Resolves (and caches) the
 * advertising page id on first use, then page-searches it for the complete set.
 * Skips cleanly (no noisy keyword fallback) when the competitor can't be resolved.
 */
export async function ingestCompetitorAds(competitor: Competitor, nicheStreamId: string | null, caps: Caps): Promise<AdIngestResult> {
  let pageId = competitor.fbPageId?.trim() || null;
  if (!pageId) pageId = await resolveCompetitorPageId(competitor, caps);
  if (!pageId) return emptyResult();
  const url = pageSearchUrl(pageId, DEFAULT_COUNTRY);
  return ingestFromUrls([url], caps.adsPerQuery, { competitorId: competitor.id, nicheStreamId }, caps);
}

/** Pull every active (non-archived) competitor for a brand. */
export async function ingestBrandCompetitorAds(
  brandId: string,
  nicheStreamId: string | null,
  caps: Caps,
): Promise<{ result: AdIngestResult; competitorsPulled: number }> {
  const competitors = (await listCompetitors(brandId)).filter((c) => c.status !== "archived");
  const agg = emptyResult();
  for (const c of competitors) {
    mergeResult(agg, await ingestCompetitorAds(c, nicheStreamId, caps));
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
 * per-scope counts. Synchronous (run-sync per query) — this is the explicit,
 * operator-triggered Phase-3 path; the weekly async orchestration lands in a
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
