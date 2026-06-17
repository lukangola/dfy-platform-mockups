# AdSpy Ad-Source Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Ad Inspo Console's competitor/keyword ad source — swap the gethookd API for the AdSpy API, ranking ads by real (log-scaled) shares, scoped to US/CA/UK/AU, with verified-only competitor matching plus a competitor-name-in-copy lane.

**Architecture:** Same DB seam as today — a server-side pull writes into the global `ad_creatives` pool, which `adConsoleFeed.ts` ranks into per-brand `feed_items`. Only the **source** changes: a new `server/lib/adspy.ts` client replaces `gethookd.ts`; `adConsoleAds.ts` is rewritten as two lanes (competitor + keyword); `adConsoleFeed.ts` swaps traction to log-scaled shares. Organic (Apify) is untouched.

**Tech Stack:** Express + TypeScript (ESM), Drizzle ORM (Postgres/Supabase) with drizzle-kit migrations, vitest, React 19 + Vite client. Commands: `pnpm check` (tsc --noEmit), `pnpm exec vitest run --root . <file>`, `pnpm db:generate` + `pnpm db:migrate`, server scripts via `pnpm exec tsx --env-file=.env.local`.

**Branch:** Work on `adspy-ad-source` (already cut from `gethookd-ad-source` tip; the design spec is its first commit). Partial-stage explicit file lists per commit — never `git add -A`, never stage `server/data/reference-style.json`, never `--no-verify`.

**Spec:** `docs/superpowers/specs/2026-06-16-adspy-ad-source-switch-design.md`

**Ordering note:** Tasks are ordered so `pnpm check` stays green after every commit. New columns and the AdSpy module are added first (additive); gethookd columns are dropped and `gethookd.ts` deleted only after all code stops referencing them (Tasks 8–9).

---

### Task 1: Schema — add AdSpy columns (additive migration)

**Files:**
- Modify: `server/db/schema.ts`
- Generated: `drizzle/00NN_*.sql` (drizzle-kit picks the number + name)

- [ ] **Step 1: Add the three `ad_creatives` columns**

In `server/db/schema.ts`, in the `adCreatives` table, find:

```ts
  variationCount: integer("variation_count"),
  tractionScore: numeric("traction_score", { precision: 10, scale: 4 }), // gethookd performance_score/100 (0..1)
```

Replace with:

```ts
  variationCount: integer("variation_count"),
  // AdSpy engagement — `shares` (snapshot.shareNum) is the rank driver; `likes`
  // for display; `deepLinkUrl` (linkToAd) opens the live FB/IG post.
  shares: integer("shares"),
  likes: integer("likes"),
  deepLinkUrl: text("deep_link_url"),
  tractionScore: numeric("traction_score", { precision: 10, scale: 4 }), // 0..1 (AdSpy: log-scaled shares)
```

- [ ] **Step 2: Add the two `competitors` columns**

In the `competitors` table, find:

```ts
  igHandle: text("ig_handle"),
  tiktokHandle: text("tiktok_handle"),
  gethookdBrandId: text("gethookd_brand_id"),       // resolved + cached from gethookd /brands
  brandspyActive: boolean("brandspy_active").notNull().default(false),
```

Replace with (keep the gethookd lines for now — they're dropped in Task 9):

```ts
  igHandle: text("ig_handle"),
  tiktokHandle: text("tiktok_handle"),
  adspyAdvertiserId: text("adspy_advertiser_id"),   // resolved + cached AdSpy advertiser userId (verified)
  adspyVerified: boolean("adspy_verified").notNull().default(false),
  gethookdBrandId: text("gethookd_brand_id"),       // (removed in the AdSpy switch — Task 9)
  brandspyActive: boolean("brandspy_active").notNull().default(false),
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/00NN_<name>.sql` appears with `ALTER TABLE "ad_creatives" ADD COLUMN "shares" ...`, `... "likes" ...`, `... "deep_link_url" ...`, and `ALTER TABLE "competitors" ADD COLUMN "adspy_advertiser_id" ...`, `... "adspy_verified" ...`. Open the file and confirm it only ADDs (no DROP).

- [ ] **Step 4: Apply to the dev DB**

Run: `pnpm db:migrate`
Expected: "Migrations complete." with no error.

- [ ] **Step 5: Typecheck**

Run: `pnpm check`
Expected: passes (columns are additive; nothing yet reads them).

- [ ] **Step 6: Commit**

```bash
git add server/db/schema.ts drizzle/
git commit -m "schema: add AdSpy ad_creatives (shares/likes/deep_link_url) + competitor advertiser columns"
```

---

### Task 2: AdSpy client + normalize + traction + matcher (with tests)

**Files:**
- Create: `server/lib/adspy.ts`
- Test: `server/lib/adspy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/lib/adspy.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  AdspyClient,
  AdspyAuthError,
  normalizeAdspyAd,
  scoreAdspyTraction,
  adspySeenBetween,
  adMatchesCompetitor,
  type AdspyAd,
} from "./adspy.js";

describe("AdspyClient.searchAds", () => {
  it("POSTs /api/ad with bearer + JSON body and returns the array", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [{ id: 1 }, { id: 2 }] });
    const c = new AdspyClient({ apiKey: "tok", baseUrl: "https://api.test", fetchImpl });
    const ads = await c.searchAds({
      searches: [{ type: "texts", value: "gut health" }],
      countries: ["US", "CA", "UK", "AU"],
      orderBy: "total_shares",
      page: 1,
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://api.test/api/ad");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.searches).toEqual([{ type: "texts", value: "gut health", locked: false }]);
    expect(body.countries).toEqual(["US", "CA", "UK", "AU"]);
    expect(body.orderBy).toBe("total_shares");
    expect(body.page).toBe(1);
    expect(ads).toHaveLength(2);
  });

  it("throws AdspyAuthError on 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const c = new AdspyClient({ apiKey: "tok", baseUrl: "https://api.test", fetchImpl });
    await expect(c.searchAds({ userId: "1" })).rejects.toBeInstanceOf(AdspyAuthError);
  });

  it("throws on other non-ok statuses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const c = new AdspyClient({ apiKey: "tok", baseUrl: "https://api.test", fetchImpl });
    await expect(c.searchAds({ userId: "1" })).rejects.toThrow(/500/);
  });
});

const fbAd: AdspyAd = {
  id: 971,
  isIg: false,
  adType: "Video",
  text: "Try our greens",
  createdOn: "2026-04-28T12:06:59",
  actor: { userId: "100082299859730", name: "Kapiva", username: "kapivahealth" },
  snapshot: { shareNum: 3026, likeNum: 174337 },
  mainAttachment: {
    type: "Video",
    videoUrl: "https://c/x.mp4",
    imageUrl: "https://c/x.jpg",
    actionLinkTitle: "Shop now",
    url: "https://kapiva.in/x",
    state: "active",
  },
  linkToAd: "https://www.facebook.com/100082299859730/posts/971",
};

const igAd: AdspyAd = {
  id: 55,
  isIg: true,
  adType: "Image",
  text: "glow",
  actor: { userId: "777", name: "Glow", username: "GlowRecipe" },
  snapshot: { shareNum: 10 },
  mainAttachment: { type: "Image", imageUrl: "https://c/g.jpg", url: "https://glow/x", state: "inactive" },
  linkToAd: "https://www.instagram.com/p/abc",
};

describe("normalizeAdspyAd", () => {
  it("maps an FB video ad incl. deep link, advertiser id, shares", () => {
    const n = normalizeAdspyAd(fbAd);
    expect(n.externalId).toBe("971");
    expect(n.advertiserId).toBe("100082299859730");
    expect(n.pageId).toBe("100082299859730");
    expect(n.advertiserUsername).toBe("kapivahealth");
    expect(n.deepLinkUrl).toBe("https://www.facebook.com/100082299859730/posts/971");
    expect(n.format).toBe("video");
    expect(n.copy).toBe("Try our greens");
    expect(n.cta).toBe("Shop now");
    expect(n.landingUrl).toBe("https://kapiva.in/x");
    expect(n.shares).toBe(3026);
    expect(n.likes).toBe(174337);
    expect(n.isActive).toBe(true);
    expect(n.isIg).toBe(false);
    expect(n.mediaUrls).toContain("https://c/x.mp4");
  });

  it("maps an IG image ad (isIg, static, inactive)", () => {
    const n = normalizeAdspyAd(igAd);
    expect(n.isIg).toBe(true);
    expect(n.format).toBe("static");
    expect(n.isActive).toBe(false);
    expect(n.advertiserUsername).toBe("GlowRecipe");
    expect(n.shares).toBe(10);
  });
});

describe("scoreAdspyTraction", () => {
  it("log-scales shares to 0..1", () => {
    expect(scoreAdspyTraction(0)).toBe(0);
    expect(scoreAdspyTraction(100000)).toBe(1);
    const mid = scoreAdspyTraction(1000);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe("adspySeenBetween", () => {
  it("returns a two-element DD-MMM-YYYY range", () => {
    const [start, end] = adspySeenBetween(365);
    expect(start).toMatch(/^\d{2}-[A-Z][a-z]{2}-\d{4}$/);
    expect(end).toMatch(/^\d{2}-[A-Z][a-z]{2}-\d{4}$/);
  });
});

describe("adMatchesCompetitor", () => {
  it("matches on FB page id (advertiserId === fbPageId)", () => {
    expect(adMatchesCompetitor(normalizeAdspyAd(fbAd), { fbPageId: "100082299859730", igHandle: null })).toBe(true);
  });
  it("matches on IG handle, case-insensitive, @ stripped", () => {
    expect(adMatchesCompetitor(normalizeAdspyAd(igAd), { fbPageId: null, igHandle: "@glowrecipe" })).toBe(true);
  });
  it("rejects when neither id nor handle matches", () => {
    expect(adMatchesCompetitor(normalizeAdspyAd(fbAd), { fbPageId: "999", igHandle: "other" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --root . server/lib/adspy.test.ts`
Expected: FAIL — `Failed to resolve import "./adspy.js"`.

- [ ] **Step 3: Create the implementation**

Create `server/lib/adspy.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --root . server/lib/adspy.test.ts`
Expected: PASS (all suites green).

- [ ] **Step 5: Typecheck**

Run: `pnpm check`
Expected: passes. (`adspy.ts` references `env.ADSPY_TOKEN` / `env.ADSPY_BASE_URL` — these are added in Task 3. If `pnpm check` fails here on those two properties, that's expected; it goes green after Task 3. To keep this task self-contained-green, do Task 3 before Step 5, or accept the two known errors here and confirm green after Task 3.)

- [ ] **Step 6: Commit**

```bash
git add server/lib/adspy.ts server/lib/adspy.test.ts
git commit -m "feat: AdSpy REST client + normalize + log-share traction + advertiser matcher"
```

---

### Task 3: env — add AdSpy config

**Files:**
- Modify: `server/lib/env.ts`
- Modify: `.env.local` (gitignored — do NOT commit)

- [ ] **Step 1: Add AdSpy env keys**

In `server/lib/env.ts`, find:

```ts
  // gethookd ad-intelligence API — the Ad Console's competitor/niche ad source.
  GETHOOKD_API_KEY: process.env.GETHOOKD_API_KEY ?? "",
  GETHOOKD_BASE_URL: process.env.GETHOOKD_BASE_URL ?? "https://app.gethookd.ai",
  GETHOOKD_CREDIT_RESERVE: Number(process.env.GETHOOKD_CREDIT_RESERVE ?? 50),
```

Replace with (keep gethookd for now; removed in Task 8):

```ts
  // AdSpy ad-intelligence API — the Ad Inspo Console's competitor/keyword ad source.
  ADSPY_TOKEN: process.env.ADSPY_TOKEN ?? "",
  ADSPY_BASE_URL: process.env.ADSPY_BASE_URL ?? "https://api.adspy.com",
  // gethookd (removed in the AdSpy switch — Task 8).
  GETHOOKD_API_KEY: process.env.GETHOOKD_API_KEY ?? "",
  GETHOOKD_BASE_URL: process.env.GETHOOKD_BASE_URL ?? "https://app.gethookd.ai",
  GETHOOKD_CREDIT_RESERVE: Number(process.env.GETHOOKD_CREDIT_RESERVE ?? 50),
```

- [ ] **Step 2: Confirm `.env.local` has the token**

Run: `grep -c '^ADSPY_TOKEN=' .env.local`
Expected: `1` (already present from the API test). If `0`, add `ADSPY_TOKEN=<token>` to `.env.local` — do not print or commit the value.

- [ ] **Step 3: Typecheck**

Run: `pnpm check`
Expected: passes (and Task 2's `adspy.ts` env references now resolve).

- [ ] **Step 4: Commit** (env.ts only — `.env.local` is gitignored)

```bash
git add server/lib/env.ts
git commit -m "env: add ADSPY_TOKEN + ADSPY_BASE_URL"
```

---

### Task 4: Rewrite `adConsoleAds.ts` to AdSpy two-lane ingest

**Files:**
- Modify: `server/lib/adConsoleAds.ts` (full rewrite of imports, persistence, both lanes, resolver)

This task replaces the gethookd-specific internals while keeping the EXPORTED function names + signatures identical (`ingestNicheStreamAds`, `ingestCompetitorAds`, `ingestBrandCompetitorAds`, `ingestBrandAds`, `AdIngestResult`, `BrandAdIngestSummary`) so the route + pull orchestration are untouched.

- [ ] **Step 1: Replace the import block + constants**

In `server/lib/adConsoleAds.ts`, replace the import block (lines ~22–46, from `import { and, eq, sql }` through `const GETHOOKD_SOURCE = "gethookd";`) with:

```ts
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
```

- [ ] **Step 2: Rewrite `upsertAdCreative` for the AdSpy shape**

Replace the entire `upsertAdCreative` function (the `async function upsertAdCreative(...) { ... }` block, ~lines 93–172) with:

```ts
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
```

- [ ] **Step 3: Rewrite `ingestAds`**

Replace the `ingestAds` function (~lines 181–195) with:

```ts
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
```

(Note: `ingestAds` no longer takes `caps` — the `upsertAdCreative` lookback-skip is gone because AdSpy pulls are already recency-scoped server-side. Callers below pass no `caps` to `ingestAds`.)

- [ ] **Step 4: Rewrite the keyword lane `ingestNicheStreamAds`**

Replace the entire `ingestNicheStreamAds` function (its doc comment + body, ~lines 210–276) with:

```ts
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
```

- [ ] **Step 5: Replace the gethookd resolver with the AdSpy verifier + competitor lane**

Replace everything from `const NAME_NOISE_RE = ...` through the end of `ingestCompetitorAds` (the `resolveGethookdBrand` helper, `nameWords`, `NAME_NOISE_RE`, and the old `ingestCompetitorAds` — ~lines 278–396) with:

```ts
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
```

- [ ] **Step 6: Update the batch + brand orchestration to the new signatures**

Replace `ingestBrandCompetitorAds` (~lines 404–420) with (note: `ingestCompetitorAds` no longer takes `caps`; `AdspyAuthError` replaces `CreditExhaustedError`):

```ts
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
```

Then in `ingestBrandAds`, find the competitors call:

```ts
    const { result, competitorsPulled: n } = await ingestBrandCompetitorAds(brandId, stream?.id ?? null, resolveCaps(stream));
```

Replace with:

```ts
    const { result, competitorsPulled: n } = await ingestBrandCompetitorAds(brandId, stream?.id ?? null);
```

- [ ] **Step 7: Typecheck**

Run: `pnpm check`
Expected: passes. (Confirm no remaining references to `getGethookdClient`, `CreditExhaustedError`, `scoreGethookdTraction`, `resolveCaps`'s now-unused `caps` arg to `ingestAds`, `gethookdBrandId`, `brandspyActive` in this file.)

- [ ] **Step 8: Commit**

```bash
git add server/lib/adConsoleAds.ts
git commit -m "feat: rewrite ad ingest on AdSpy — verified competitor lane + name-in-copy + keyword lane"
```

---

### Task 5: Rank ads by log-scaled shares

**Files:**
- Modify: `server/lib/adConsoleFeed.ts`

- [ ] **Step 1: Replace the ad-traction sub-blend constants**

In `server/lib/adConsoleFeed.ts`, replace the "Ad traction sub-blend" block (the comment + `TRACTION_PERF_W` / `TRACTION_LONGEVITY_W` / `TRACTION_SCALE_W` / `LONGEVITY_SATURATION_DAYS` / `VARIATION_SATURATION` constants, ~lines 33–46) with:

```ts
// ── Ad traction ───────────────────────────────────────────────────────────────
// AdSpy gives real engagement, so traction = the ad's REAL share count, log-scaled
// to 0..1 (~31 shares → 0, ~31k → 1). Log keeps one mega-viral outlier from
// flattening the rest while preserving "more shares = higher" within a tier.
const AD_SHARES_LO_LOG = 1.5;
const AD_SHARES_HI_LOG = 4.5;
```

- [ ] **Step 2: Widen the recency window to 365 days**

Find:

```ts
const RECENCY_WINDOW_DAYS = 180;
```

Replace with:

```ts
// 365-day decay — matches the AdSpy `seenBetween` pull window.
const RECENCY_WINDOW_DAYS = 365;
```

- [ ] **Step 3: Rewrite `adTraction`**

Replace the `adTraction` function (its doc comment + body, ~lines 150–160) with:

```ts
/** Ad traction = real shares, log-scaled to 0..1 (matches scoreAdspyTraction). */
function adTraction(ad: AdCreative): number {
  const shares = Math.max(0, ad.shares ?? 0);
  return round4(clamp01((Math.log10(shares + 1) - AD_SHARES_LO_LOG) / (AD_SHARES_HI_LOG - AD_SHARES_LO_LOG)));
}
```

- [ ] **Step 4: Show a "mentions {name}" chip for name-in-copy ads**

Find the chip line in `rankBrandFeed`:

```ts
    const chips = ad.competitorId ? ["competitor"] : foundQuery ? [foundQuery] : matched;
```

Replace with:

```ts
    // Competitor's OWN ad (no query) → "competitor"; a name-in-copy clone (query =
    // the competitor name) → "mentions {name}"; a keyword-lane ad → its query.
    const chips = ad.competitorId
      ? foundQuery
        ? [`mentions ${foundQuery}`]
        : ["competitor"]
      : foundQuery
        ? [foundQuery]
        : matched;
```

- [ ] **Step 5: Typecheck**

Run: `pnpm check`
Expected: passes. (`ad.shares` resolves against the column added in Task 1. Confirm no leftover references to `LONGEVITY_SATURATION_DAYS` / `VARIATION_SATURATION` / `TRACTION_*`.)

- [ ] **Step 6: Commit**

```bash
git add server/lib/adConsoleFeed.ts
git commit -m "feat: rank ads by log-scaled real shares; 365d recency; mentions chip"
```

---

### Task 6: Route gates — AdSpy config check, drop the gethookd credit floor

**Files:**
- Modify: `server/routes/adConsole.ts`

- [ ] **Step 1: Swap the imports**

In `server/routes/adConsole.ts`, find:

```ts
import { isGethookdConfigured, getGethookdClient } from "../lib/gethookd.js";
import { env } from "../lib/env.js";
```

Replace with:

```ts
import { isAdspyConfigured } from "../lib/adspy.js";
```

(`env` is only used by the credit-floor helper removed in Step 2; drop the import. If `pnpm check` later reports `env` used elsewhere in this file, re-add it — but it is not, per the current file.)

- [ ] **Step 2: Delete the credit-floor helper**

Remove the entire `gethookdCreditFloorBlocks` function (its doc comment + body, ~lines 50–64).

- [ ] **Step 3: Update the `/ingest-ads` gate**

Find:

```ts
    if (!isGethookdConfigured()) {
      return sendError(res, 424, "GETHOOKD_API_KEY is not configured — set it before pulling ads.");
    }
    if (await gethookdCreditFloorBlocks(res)) return;
```

Replace with:

```ts
    if (!isAdspyConfigured()) {
      return sendError(res, 424, "ADSPY_TOKEN is not configured — set it before pulling ads.");
    }
```

- [ ] **Step 4: Update the `/pull-feed` gate**

Find:

```ts
    if (!isGethookdConfigured()) {
      return sendError(res, 424, "GETHOOKD_API_KEY is not configured — set it before pulling the feed (ads).");
    }
    if (!isApifyConfigured()) {
      return sendError(res, 424, "APIFY_TOKEN is not configured — set it before pulling the feed (organic).");
    }
    if (await gethookdCreditFloorBlocks(res)) return;
```

Replace with:

```ts
    if (!isAdspyConfigured()) {
      return sendError(res, 424, "ADSPY_TOKEN is not configured — set it before pulling the feed (ads).");
    }
    if (!isApifyConfigured()) {
      return sendError(res, 424, "APIFY_TOKEN is not configured — set it before pulling the feed (organic).");
    }
```

- [ ] **Step 5: Typecheck**

Run: `pnpm check`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add server/routes/adConsole.ts
git commit -m "feat: gate ad pulls on ADSPY_TOKEN; remove gethookd credit floor"
```

---

### Task 7: Client — type + card (share badge, deep link)

**Files:**
- Modify: `client/src/lib/api.ts`
- Modify: `client/src/pages/workspace/AdConsolePage.tsx`

- [ ] **Step 1: Add the new fields to `AdConsoleAdCreative`**

In `client/src/lib/api.ts`, in `export type AdConsoleAdCreative`, find:

```ts
  /** `numeric` → string on the wire. */
  tractionScore: string | null;
```

Replace with:

```ts
  /** AdSpy real engagement + deep link to the live FB/IG post. */
  shares: number | null;
  likes: number | null;
  deepLinkUrl: string | null;
  /** `numeric` → string on the wire. */
  tractionScore: string | null;
```

- [ ] **Step 2: Remove gethookd fields from the competitor type (if present)**

Run: `grep -n "gethookd\|brandspy" client/src/lib/api.ts`
For any `gethookdBrandId` / `brandspyActive` field found in `AdConsoleCompetitor`, delete that line. (These were server-only; the client type may not include them — if grep returns nothing, skip.)

- [ ] **Step 3: Import the `Heart` icon for likes**

In `client/src/pages/workspace/AdConsolePage.tsx`, find the lucide import line containing `Bookmark, Share2, Layers`:

```ts
  Megaphone, Flame, Lightbulb, X, ExternalLink, Clock, Eye, Bookmark, Share2, Layers,
```

Replace with:

```ts
  Megaphone, Flame, Lightbulb, X, ExternalLink, Clock, Eye, Bookmark, Share2, Heart, Layers,
```

- [ ] **Step 4: Show shares + likes in the ad traction bits**

Find:

```ts
  if (ad) {
    if (ad.runtimeDays != null) tractionBits.push({ icon: Clock, label: `${ad.runtimeDays}d running` });
    if (ad.variationCount != null && ad.variationCount > 1)
      tractionBits.push({ icon: Layers, label: `${ad.variationCount} variants` });
  }
```

Replace with:

```ts
  if (ad) {
    const sh = compact(ad.shares);
    if (sh) tractionBits.push({ icon: Share2, label: `${sh} shares` });
    const lk = compact(ad.likes);
    if (lk) tractionBits.push({ icon: Heart, label: lk });
  }
```

- [ ] **Step 5: Prefer the AdSpy deep link for the source + "Original ad" link**

Find:

```ts
  const sourceUrl = ad?.pageUrl ?? organic?.postUrl ?? ad?.landingUrl ?? null;
```

Replace with:

```ts
  const sourceUrl = ad?.deepLinkUrl ?? ad?.pageUrl ?? organic?.postUrl ?? ad?.landingUrl ?? null;
```

Then find the `adLibraryUrl` definition:

```ts
  const adLibraryUrl = ad?.externalId
    ? `https://www.facebook.com/ads/library/?id=${ad.externalId}`
    : ad?.pageId
      ? `https://www.facebook.com/ads/library/?view_all_page_id=${ad.pageId}`
      : null;
```

Replace with:

```ts
  // Prefer the AdSpy deep link to the live FB/IG post; fall back to the Meta Ad
  // Library lookup when a legacy row has no deep link.
  const adLibraryUrl = ad?.externalId
    ? `https://www.facebook.com/ads/library/?id=${ad.externalId}`
    : ad?.pageId
      ? `https://www.facebook.com/ads/library/?view_all_page_id=${ad.pageId}`
      : null;
  const adLink = ad?.deepLinkUrl ?? adLibraryUrl;
```

Then find the Ad Library anchor:

```ts
            {adLibraryUrl && (
              <a
                href={adLibraryUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[9px] font-mono text-white/30 hover:text-cyan-300 transition-colors"
                title="View in Meta Ad Library"
              >
                <ExternalLink size={11} /> Ad Library
              </a>
            )}
```

Replace with:

```ts
            {adLink && (
              <a
                href={adLink}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[9px] font-mono text-white/30 hover:text-cyan-300 transition-colors"
                title="View the original ad"
              >
                <ExternalLink size={11} /> Original ad
              </a>
            )}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm check`
Expected: passes. (If `Layers` is now unused after Step 4, remove it from the import to satisfy the linter; re-run.)

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/api.ts client/src/pages/workspace/AdConsolePage.tsx
git commit -m "feat: ad cards show real shares/likes + deep link to the original ad"
```

---

### Task 8: Delete gethookd + clean up remaining references

**Files:**
- Delete: `server/lib/gethookd.ts`, `server/lib/gethookd.test.ts`
- Modify: `server/lib/env.ts`, `.env.local` (gitignored), plus any straggler comments

- [ ] **Step 1: Delete the gethookd module + its test**

Run:

```bash
git rm server/lib/gethookd.ts server/lib/gethookd.test.ts
```

- [ ] **Step 2: Remove the gethookd env keys**

In `server/lib/env.ts`, delete these three lines:

```ts
  // gethookd (removed in the AdSpy switch — Task 8).
  GETHOOKD_API_KEY: process.env.GETHOOKD_API_KEY ?? "",
  GETHOOKD_BASE_URL: process.env.GETHOOKD_BASE_URL ?? "https://app.gethookd.ai",
  GETHOOKD_CREDIT_RESERVE: Number(process.env.GETHOOKD_CREDIT_RESERVE ?? 50),
```

- [ ] **Step 3: Find and clean any remaining gethookd references**

Run: `grep -rni "gethookd" server client --include="*.ts" --include="*.tsx"`
Expected after cleanup: matches ONLY in `docs/` (specs — leave those). For any code/comment match (e.g. a comment in `adConsolePull.ts`, the `source` comment on `adCreatives` in `schema.ts`, the `creativeFingerprint` comment in `adConsoleFeed.ts`, the `BrandAdIngestSummary` doc in `adConsoleAds.ts`), update the wording from "gethookd" to "AdSpy" (or remove it). These are comment-only edits — no behavior change.

- [ ] **Step 4: Remove gethookd keys from `.env.local`** (gitignored — not committed)

Run: `grep -n "GETHOOKD" .env.local`
Delete any `GETHOOKD_*` lines found (leave `ADSPY_TOKEN`). This file is not staged.

- [ ] **Step 5: Typecheck + full test run**

Run: `pnpm check`
Expected: passes.
Run: `pnpm exec vitest run --root . server/lib/adspy.test.ts`
Expected: PASS (and the deleted `gethookd.test.ts` no longer runs).

- [ ] **Step 6: Commit**

```bash
git add server/lib/gethookd.ts server/lib/gethookd.test.ts server/lib/env.ts server/lib/adConsoleAds.ts server/lib/adConsoleFeed.ts server/lib/adConsolePull.ts server/db/schema.ts
git commit -m "chore: remove gethookd module, env, and stale references"
```

(Only `git add` the files you actually touched in Step 3 — adjust the list to match. Do NOT stage `server/data/reference-style.json`.)

---

### Task 9: Drop the gethookd competitor columns (migration)

**Files:**
- Modify: `server/db/schema.ts`
- Generated: `drizzle/00NN_*.sql`

- [ ] **Step 1: Remove the columns from the schema**

In `server/db/schema.ts`, in the `competitors` table, delete:

```ts
  gethookdBrandId: text("gethookd_brand_id"),       // (removed in the AdSpy switch — Task 9)
  brandspyActive: boolean("brandspy_active").notNull().default(false),
```

- [ ] **Step 2: Generate the drop migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/00NN_<name>.sql` with `ALTER TABLE "competitors" DROP COLUMN "gethookd_brand_id";` and `... DROP COLUMN "brandspy_active";`. Confirm it only DROPs these two.

- [ ] **Step 3: Apply to the dev DB**

Run: `pnpm db:migrate`
Expected: "Migrations complete."

- [ ] **Step 4: Typecheck**

Run: `pnpm check`
Expected: passes (nothing references the dropped columns after Task 4).

- [ ] **Step 5: Commit**

```bash
git add server/db/schema.ts drizzle/
git commit -m "schema: drop gethookd_brand_id + brandspy_active from competitors"
```

---

### Task 10: End-to-end verification on dev

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + tests**

Run: `pnpm check`
Expected: passes.
Run: `pnpm exec vitest run --root . server/lib/adspy.test.ts`
Expected: PASS.

- [ ] **Step 2: Confirm the dev server is running**

Run: `lsof -ti :3001 >/dev/null && echo "API up" || echo "start it: pnpm dev"`
If down, start `pnpm dev` (client :3000, API :3001).

- [ ] **Step 3: Live pull for the test brand (Alcami Elements)**

In the Ad Inspo Console (manager/admin, Alcami brand), click **Pull this week's feed**. Watch the pull-progress strip to completion.

- [ ] **Step 4: Verify the data landed correctly**

Run a throwaway query script (adjust the brand name filter if needed):

```bash
pnpm exec tsx --env-file=.env.local -e '
import { db, schema } from "./server/lib/db.js";
import { eq, and, isNotNull, desc } from "drizzle-orm";
const ads = await db.select().from(schema.adCreatives).where(eq(schema.adCreatives.source, "adspy")).orderBy(desc(schema.adCreatives.shares)).limit(10);
console.log("adspy ads:", ads.length);
for (const a of ads.slice(0,5)) console.log(`  shares=${a.shares} likes=${a.likes} comp=${a.competitorId?"Y":"-"} q=${a.discoveryQuery ?? ""} deep=${a.deepLinkUrl ? "Y":"-"} :: ${(a.copy??"").slice(0,50)}`);
const verified = await db.select().from(schema.competitors).where(isNotNull(schema.competitors.adspyAdvertiserId));
console.log("verified competitors:", verified.length, verified.map(c=>c.name).join(", "));
process.exit(0);
'
```

Expected:
- `adspy ads` > 0, sorted by `shares` descending.
- At least one row with `comp=Y` (competitor) and `deep=Y` (deep link present).
- At least one row with a `q=mentions`-style competitor name (name-in-copy) OR a competitor own-ad (`q` empty, `comp=Y`).
- `verified competitors` lists the competitors that resolved + locked an AdSpy advertiser id.

- [ ] **Step 5: Verify the UI**

In the Console: competitor-ad cards show a real **shares** badge, an **Original ad ↗** link that opens the live FB/IG post, and name-in-copy cards show a **mentions {name}** chip. The feed orders by shares within relevance tiers. Confirm unverifiable competitors logged a "could NOT verify" line in the server console.

- [ ] **Step 6: Final commit (if any verification fixes were needed)**

```bash
git add <only files you changed>
git commit -m "fix: AdSpy pull verification adjustments"
```

---

## Notes for the implementer

- **Ship checklist (not in this plan):** add `ADSPY_TOKEN` to the production environment before this branch ships; `DATABASE_URL` stays per-environment (never copy dev → prod).
- **AdSpy quota is unknown** — the per-lane page caps (`ADSPY_*_PAGES`) are deliberately small. If the first real pull reveals a generous quota, raise them; if it 429s, lower them.
- **Token expiry** surfaces as `AdspyAuthError` (401) → the keyword sweep returns partial results and the competitor batch breaks; the pull-status will show fewer ads rather than a hard crash. Re-mint the token in `.env.local`.
- **Tuning knobs:** `SHARES_LO_LOG`/`SHARES_HI_LOG` (adspy.ts) and `AD_SHARES_LO_LOG`/`AD_SHARES_HI_LOG` (adConsoleFeed.ts) must stay in sync if you re-tune the share→traction curve.
- **`seenBetween` is live-verified** (`DD-MMM-YYYY`, e.g. `16-Jun-2025` → `16-Jun-2026`) — returns 200 with correctly share-sorted results. If a future pull ever zeroes out, the one-line fix is to drop the `seenBetween` arg from the lane calls and rely on the ranker's recency factor.
- **Deferred (fast follow, not in this plan):** surfacing the "couldn't verify on AdSpy" competitor count in the Setup panel. For v1 it's a server-log line; `adspy_verified` is persisted, so a Setup "verified ✓ / unverified" badge is a cheap follow-up (client `AdConsoleCompetitor` type + a badge in `SetupPanel`).
