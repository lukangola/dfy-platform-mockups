import { env } from "./env.js";

// ---------------------------------------------------------------------------
// AdSpy REST client — competitor/keyword ad intelligence for the Ad Inspo
// Console. Token auth (OAuth password-grant bearer; can expire → 401). POST
// /api/ad returns up to 10 ad objects/page; we sort server-side by
// total_shares so the highest-shared ads arrive first. Verified live 2026-06-16.
// ---------------------------------------------------------------------------

export function isAdspyConfigured(): boolean {
  return Boolean(env.ADSPY_TOKEN);
}

/** The four target markets. AdSpy's code for the United Kingdom is "UK" (not "GB"). */
export const ADSPY_COUNTRIES = ["US", "CA", "UK", "AU"] as const;

export type AdspySearchType = "texts" | "advertisers" | "urls" | "lp_urls" | "comments" | "page_text";

export interface AdspySearch {
  type: AdspySearchType;
  value: string;
  /** false = OR / true = AND (exact phrase) across same-type entries. */
  locked?: boolean;
}

export interface AdspySearchParams {
  searches?: AdspySearch[];
  countries?: readonly string[];
  siteType?: "facebook" | "instagram";
  mediaType?: "video" | "photo";
  seenBetween?: [string, string];
  username?: string;
  userId?: string;
  orderBy?: string;
  page?: number;
}

export interface AdspyActor {
  userId?: string;
  name?: string;
  username?: string;
  profilePicture?: string;
}

export interface AdspyAttachment {
  type?: string;
  videoUrl?: string | null;
  imageUrl?: string | null;
  actionLinkTitle?: string | null;
  url?: string | null;
  state?: string;
}

export interface AdspySnapshot {
  shareNum?: number;
  likeNum?: number;
  commentsNum?: number;
  loveNum?: number;
  hahaNum?: number;
  wowNum?: number;
  sadNum?: number;
  angryNum?: number;
}

export interface AdspyAd {
  id: string | number;
  isIg?: boolean;
  adType?: string; // "Video" | "Image"
  text?: string;
  createdOn?: string;
  actor?: AdspyActor;
  snapshot?: AdspySnapshot;
  mainAttachment?: AdspyAttachment;
  attachments?: AdspyAttachment[];
  linkToAd?: string;
  countries?: string[];
}

/** Thrown on a 401 — the token expired or is invalid. Re-mint ADSPY_TOKEN. */
export class AdspyAuthError extends Error {
  constructor() {
    super("AdSpy token expired or invalid (401) — re-mint ADSPY_TOKEN.");
    this.name = "AdspyAuthError";
  }
}

export class AdspyClient {
  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(o: { apiKey: string; baseUrl: string; fetchImpl?: typeof fetch }) {
    this.apiKey = o.apiKey;
    this.baseUrl = o.baseUrl;
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  /** POST /api/ad — returns up to 10 ads for the page. Throws AdspyAuthError on 401. */
  async searchAds(p: AdspySearchParams): Promise<AdspyAd[]> {
    const body: Record<string, unknown> = {};
    if (p.searches?.length) {
      body.searches = p.searches.map((s) => ({ type: s.type, value: s.value, locked: s.locked ?? false }));
    }
    if (p.countries?.length) body.countries = Array.from(p.countries);
    if (p.siteType) body.siteType = p.siteType;
    if (p.mediaType) body.mediaType = p.mediaType;
    if (p.seenBetween) body.seenBetween = p.seenBetween;
    if (p.username) body.username = p.username;
    if (p.userId) body.userId = p.userId;
    if (p.orderBy) body.orderBy = p.orderBy;
    if (p.page) body.page = p.page;

    const res = await this.fetchImpl(this.baseUrl + "/api/ad", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new AdspyAuthError();
    if (!res.ok) throw new Error(`AdSpy /api/ad failed: ${res.status}`);
    const json = (await res.json()) as unknown;
    return Array.isArray(json) ? (json as AdspyAd[]) : [];
  }
}

/** Singleton client using env-configured credentials. Throws if ADSPY_TOKEN is unset. */
export function getAdspyClient(): AdspyClient {
  if (!env.ADSPY_TOKEN) throw new Error("ADSPY_TOKEN not set");
  return new AdspyClient({ apiKey: env.ADSPY_TOKEN, baseUrl: env.ADSPY_BASE_URL });
}

// ---------------------------------------------------------------------------
// Normalization — field shape matches adConsoleAds.upsertAdCreative writes
// ---------------------------------------------------------------------------

export interface NormalizedAdspyAd {
  externalId: string;
  advertiserName?: string;
  /** actor.userId — exact advertiser identity (== FB deep-link page id). */
  advertiserId?: string;
  /** actor.username — used for IG handle verification. */
  advertiserUsername?: string;
  pageId?: string;
  /** linkToAd — the live FB/IG post. */
  deepLinkUrl?: string;
  mediaUrls: string[];
  thumbnailUrl?: string;
  format: "static" | "video";
  copy?: string;
  cta?: string;
  landingUrl?: string;
  createdOn?: Date;
  isActive: boolean;
  isIg: boolean;
  shares: number;
  likes: number;
  rawJson: AdspyAd;
}

export function normalizeAdspyAd(ad: AdspyAd): NormalizedAdspyAd {
  const main: AdspyAttachment = ad.mainAttachment ?? {};
  const all = ad.attachments?.length ? ad.attachments : [main];
  const mediaUrls = all
    .map((a) => a.videoUrl || a.imageUrl)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  const isVideo = (ad.adType ?? "").toLowerCase() === "video" || (main.type ?? "").toLowerCase() === "video";
  const created = ad.createdOn ? new Date(ad.createdOn) : undefined;
  return {
    externalId: String(ad.id),
    advertiserName: ad.actor?.name,
    advertiserId: ad.actor?.userId,
    advertiserUsername: ad.actor?.username,
    pageId: ad.actor?.userId,
    deepLinkUrl: ad.linkToAd,
    mediaUrls,
    thumbnailUrl: main.imageUrl ?? undefined,
    format: isVideo ? "video" : "static",
    copy: ad.text,
    cta: main.actionLinkTitle ?? undefined,
    landingUrl: main.url ?? undefined,
    createdOn: created && !Number.isNaN(created.getTime()) ? created : undefined,
    isActive: (main.state ?? "").toLowerCase() === "active",
    isIg: Boolean(ad.isIg),
    shares: Math.max(0, ad.snapshot?.shareNum ?? 0),
    likes: Math.max(0, ad.snapshot?.likeNum ?? 0),
    rawJson: ad,
  };
}

// ---------------------------------------------------------------------------
// Traction — real shares, log-scaled to 0..1. ~31 shares → 0, ~31k → 1.
// Log (not raw/linear) keeps a single mega-viral outlier from flattening the
// rest while preserving "more shares = higher" within a relevance tier. (Tunable.)
// ---------------------------------------------------------------------------
const SHARES_LO_LOG = 1.5;
const SHARES_HI_LOG = 4.5;

export function scoreAdspyTraction(shares: number): number {
  const s = Math.max(0, shares);
  const v = (Math.log10(s + 1) - SHARES_LO_LOG) / (SHARES_HI_LOG - SHARES_LO_LOG);
  return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// Recency window — AdSpy `seenBetween` takes DD-MMM-YYYY dates (verified live).
// ---------------------------------------------------------------------------
const ADSPY_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtAdspyDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}-${ADSPY_MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

/** `seenBetween` window for the last `days` days, in AdSpy's DD-MMM-YYYY format. */
export function adspySeenBetween(days: number): [string, string] {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  return [fmtAdspyDate(start), fmtAdspyDate(end)];
}

/**
 * Exact verification: does this AdSpy ad's advertiser match the competitor?
 * FB → advertiserId (== deep-link page id) === fb_page_id; IG → username ===
 * ig_handle (case-insensitive, leading @ stripped). Name alone is never trusted.
 */
export function adMatchesCompetitor(
  ad: NormalizedAdspyAd,
  ids: { fbPageId?: string | null; igHandle?: string | null },
): boolean {
  const fb = (ids.fbPageId ?? "").trim();
  if (fb && ad.advertiserId && ad.advertiserId === fb) return true;
  const ig = (ids.igHandle ?? "").trim().replace(/^@/, "").toLowerCase();
  const u = (ad.advertiserUsername ?? "").trim().replace(/^@/, "").toLowerCase();
  if (ig && u && ig === u) return true;
  return false;
}
