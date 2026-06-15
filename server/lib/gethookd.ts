import { env } from "./env.js";

// ---------------------------------------------------------------------------
// gethookd REST client — competitor/niche ad intelligence for the Ad Console.
//
// The API uses bearer-token auth and returns paginated ad records together with
// credit-accounting fields (used_credits, remaining_credits). A 402 response
// means the account has hit its credit limit; we surface that as a typed error
// so callers can degrade gracefully.
//
// All HTTP is done via the platform's built-in fetch (or an injected fetchImpl
// for tests). No SDK dependency.
// ---------------------------------------------------------------------------

export function isGethookdConfigured(): boolean {
  return Boolean(env.GETHOOKD_API_KEY);
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

// Live values are capitalized ("Scaling") but the filter is case-insensitive, so
// lowercase inputs work. Bands: testing=1, scaling=41, growing=61, optimized=81, winning=91.
export type PerformanceTitle = "testing" | "scaling" | "growing" | "optimized" | "winning";

export interface GethookdAd {
  id: string | number;
  external_id?: string;
  title?: string;
  body?: string;
  link_description?: string | null;
  cta_type?: string;
  cta_text?: string;
  landing_page?: string;
  asset_type?: string;
  performance_score?: number;
  performance_score_title?: PerformanceTitle;
  ad_spend_range_score?: number;
  ad_spend_range_score_title?: string;
  days_active?: number;
  used_count?: number;
  active_in_library?: 0 | 1;
  start_date?: string;
  end_date?: string;
  platform?: string;
  display_format?: string;
  page_type?: string;
  share_url?: string;
  primary_media?: {
    type?: string;
    url?: string;
    resized_url?: string | null;
    thumbnail_url?: string | null;
    video_length?: number;
  };
  primary_image_url?: string;
  media?: {
    type?: string;
    url?: string;
    thumbnail_url?: string;
    video_length?: number;
  }[];
  ad_cards?: {
    title?: string;
    body?: string;
    caption?: string;
    cta_type?: string;
    cta_text?: string;
    landing_page?: string;
  }[];
  brand?: {
    external_id?: string;
    name?: string;
    logo_url?: string;
    active_ads?: number;
  };
}

export interface GethookdBrand {
  /** gethookd's INTERNAL brand id — the one BrandSpy + /brandspy/{id}/top-ads expect. */
  id: number;
  /** Platform (Meta) page id — NOT accepted by BrandSpy. */
  external_id: string;
  name: string;
  logo_url?: string;
  active_ads?: number;
}

export interface GethookdCredits {
  used: number;
  remaining: number;
}

export interface GethookdResponse<T> {
  data: T;
  credits?: GethookdCredits;
}

export class CreditExhaustedError extends Error {
  constructor() {
    super("gethookd credits exhausted (402)");
    this.name = "CreditExhaustedError";
  }
}

// ---------------------------------------------------------------------------
// Defensive readers — mirror the pattern in apify.ts
// ---------------------------------------------------------------------------

// Accepts both numbers and numeric strings — gethookd returns `remaining_credits`
// as a string ("397.96") but `used_credits` as a number.
function pickNumLoose(body: Record<string, unknown>, key: string): number | undefined {
  const v = body[key];
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface ExploreParams {
  niche?: string;
  query?: string;
  location?: string;
  performanceScores?: PerformanceTitle[];
  page?: number;
  perPage?: number;
  /**
   * Omitted by default (API default ordering). There is no performance sort
   * column. Valid columns are `used_count` | `start_date` | `created_at`.
   */
  sortColumn?: string;
  /** Omitted by default (API default ordering). */
  sortDirection?: "asc" | "desc";
}

export class GethookdClient {
  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(o: { apiKey: string; baseUrl: string; fetchImpl?: typeof fetch }) {
    this.apiKey = o.apiKey;
    this.baseUrl = o.baseUrl;
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  private async get<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<GethookdResponse<T>> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const headers: { Authorization: string } = { Authorization: `Bearer ${this.apiKey}` };
    const res = await this.fetchImpl(url.toString(), { headers });

    if (res.status === 402) throw new CreditExhaustedError();
    if (!res.ok) throw new Error(`gethookd ${path} failed: ${res.status}`);

    const body = (await res.json()) as Record<string, unknown>;

    const remaining = pickNumLoose(body, "remaining_credits");
    const credits: GethookdCredits | undefined =
      remaining !== undefined ? { used: pickNumLoose(body, "used_credits") ?? 0, remaining } : undefined;

    // Unchecked cast: we trust gethookd's response shape here — no runtime validation.
    return { data: (body["data"] ?? body) as T, credits };
  }

  authcheck() {
    return this.get<{ scopes: string[] }>("/api/v1/authcheck");
  }

  explore(p: ExploreParams) {
    return this.get<GethookdAd[]>("/api/v1/explore", {
      niche: p.niche,
      query: p.query,
      location: p.location,
      performance_scores: p.performanceScores?.join(","),
      page: p.page,
      per_page: p.perPage,
      sort_column: p.sortColumn,
      sort_direction: p.sortDirection,
    });
  }

  /**
   * Read the current remaining credit balance. Costs ~0.01 credit (a minimal
   * 1-ad /explore probe) — gethookd reports credits only on paid data calls,
   * there is no free balance endpoint. Returns the balance, or 0 when credits
   * are already exhausted (402), or null when it can't be determined (so callers
   * can fail open and rely on the hard 402 stop).
   */
  async getRemainingCredits(): Promise<number | null> {
    try {
      const res = await this.explore({ perPage: 1 });
      return res.credits?.remaining ?? null;
    } catch (e) {
      if (e instanceof CreditExhaustedError) return 0;
      return null;
    }
  }

  getAd(adId: string) {
    return this.get<GethookdAd>(`/api/v1/ads/${adId}`);
  }

  searchBrands(search: string) {
    // gethookd's brand search runs SQL LIKE, where `\` is the escape char and
    // `%`/`_` are wildcards — so a literal name like "MUD\WTR" returns nothing
    // unless we escape those characters first.
    const escaped = search.replace(/[\\%_]/g, (ch) => "\\" + ch);
    return this.get<GethookdBrand[]>("/api/v1/brands", { search: escaped });
  }

  brandsByCategory(category: string, limit = 10) {
    return this.get<GethookdBrand[]>("/api/v1/brands", {
      parent_categories: category,
      sort: "active_ads",
      per_page: limit,
    });
  }

  brandTopAds(brandId: string, limit = 20, platform?: string) {
    return this.get<GethookdAd[]>(`/api/v1/brandspy/${brandId}/top-ads`, { limit, platform });
  }

  async addBrandSpy(brandId: string): Promise<boolean> {
    const headers: { Authorization: string; "Content-Type": string } = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    const res = await this.fetchImpl(this.baseUrl + "/api/v1/brandspy", {
      method: "POST",
      headers,
      // brand_id must be gethookd's INTERNAL numeric id (NOT the page external_id).
      body: JSON.stringify({ brand_id: Number(brandId) }),
    });
    if (res.status === 402) throw new CreditExhaustedError();
    if (!res.ok && res.status !== 409) throw new Error(`gethookd /api/v1/brandspy failed: ${res.status}`);
    return res.ok || res.status === 409; // 409 = already monitored
  }
}

/** Singleton client using env-configured credentials. Throws if GETHOOKD_API_KEY is not set. */
export function getGethookdClient(): GethookdClient {
  if (!env.GETHOOKD_API_KEY) throw new Error("GETHOOKD_API_KEY not set");
  return new GethookdClient({ apiKey: env.GETHOOKD_API_KEY, baseUrl: env.GETHOOKD_BASE_URL });
}

// ---------------------------------------------------------------------------
// Ad normalization — field shape matches adConsoleAds.upsertAdCreative writes
// ---------------------------------------------------------------------------

// Shape matches the fields adConsoleAds.upsertAdCreative writes into schema.adCreatives.
// NOTE: NormalizedFbAd (Facebook source) uses `raw` internally but upsertAdCreative
// writes it as `rawJson` to the DB. For the gethookd source we store it as `rawJson`
// directly so the gethookd-specific upsert (Task 4) can write ad.rawJson unchanged.
// runtimeDays is included here because gethookd provides days_active directly,
// whereas the FB path computes runtimeDays from adStart/adStop in upsertAdCreative.
export interface NormalizedGethookdAd {
  externalId: string;
  advertiserName?: string;
  pageId?: string;
  pageUrl?: string;
  mediaUrls: string[];
  thumbnailUrl?: string;
  format: "static" | "video";
  copy?: string;
  cta?: string;
  landingUrl?: string;
  adStart?: Date;
  adStop?: Date;
  runtimeDays?: number;
  isActive: boolean;
  variationCount?: number;
  rawJson: GethookdAd;
}

export function normalizeGethookdAd(ad: GethookdAd): NormalizedGethookdAd {
  const card = ad.ad_cards?.[0];
  const mappedMedia = (ad.media ?? []).map((m) => m.url).filter((u): u is string => !!u);
  const media =
    mappedMedia.length > 0
      ? mappedMedia
      : [ad.primary_media?.url ?? ad.primary_image_url].filter((u): u is string => typeof u === "string");
  const isVideo =
    ad.display_format === "video" ||
    ad.asset_type === "video" ||
    ad.media?.[0]?.type === "video" ||
    ad.primary_media?.type === "video";
  return {
    externalId: String(ad.id),
    advertiserName: ad.brand?.name,
    pageId: ad.brand?.external_id,
    pageUrl: ad.share_url,
    mediaUrls: media,
    thumbnailUrl: ad.media?.[0]?.thumbnail_url ?? ad.primary_media?.thumbnail_url ?? undefined,
    format: isVideo ? "video" : "static",
    copy: ad.body ?? card?.body ?? card?.caption ?? ad.title,
    cta: ad.cta_text ?? card?.cta_text,
    landingUrl: ad.landing_page ?? ad.ad_cards?.find((c) => c.landing_page)?.landing_page,
    adStart: ad.start_date ? new Date(ad.start_date) : undefined,
    adStop: ad.end_date ? new Date(ad.end_date) : undefined,
    runtimeDays: ad.days_active,
    isActive: ad.active_in_library === 1,
    variationCount: ad.used_count,
    rawJson: ad,
  };
}

/**
 * gethookd performance_score → 0..1 traction. Replaces scoreAdLongevity.
 *
 * Verified live 2026-06-15: performance_score is a banded 0..100 score (NOT
 * 0..10). Observed distinct values across 150 ads: 1 (Testing), 41 (Scaling),
 * 61 (Growing), 81 (Optimized), 91 (Winning) — MIN 1, MAX 91. So we divide by
 * 100 (e.g. 41 → 0.41, 91 → 0.91) and clamp to [0, 1].
 */
export function scoreGethookdTraction(ad: GethookdAd): number {
  const s = ad.performance_score ?? 0;
  return Math.max(0, Math.min(1, s / 100));
}
