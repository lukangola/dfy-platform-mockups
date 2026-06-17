/**
 * Ad Creative Console — Instagram + TikTok organic ingestion (Phase 4).
 *
 * Pulls trending niche organic content into the GLOBAL deduped `organic_posts`
 * pool (keyed by source + post id). Two scrapers via Apify run-sync:
 *   - Instagram reels — `apify/instagram-reel-scraper` (id xMc5Ga1oCONPmWJIa),
 *     scraped by USERNAME: the niche's leading-advertiser handles plus the
 *     brand's competitor handles. IG returns view + engagement counts (and,
 *     when available, a transcript) for free.
 *   - TikTok — `clockworks/tiktok-scraper` (id GdWCkxBtKWOsKjdch), scraped by
 *     SEARCH over the niche's organic + pain-point keywords + hashtags. TikTok
 *     transcripts are a paid add-on we defer (left null in v1).
 *
 * Traction (spec §4/§7): organic has real public metrics, so we score views
 * (log-normalized) + engagement rate + recency — no outlier modeling in v1.
 * Eligibility is gated to `organicRecencyDays` so the feed reflects what's
 * working NOW. Score is normalized 0..1 to stay comparable with ad traction for
 * the Phase-5 composite.
 *
 * Credit safety mirrors Phase 3: bounded by the niche stream's caps and only
 * ever fired from an explicit manual action — never on boot or any auto path.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "./db.js";
import { env } from "./env.js";
import { DEFAULT_NICHE_CONFIG, type NicheStreamConfig } from "./nicheConfig.js";
import { listCompetitors } from "./adConsoleCompetitors.js";
import { ensureBrandNiche } from "./adConsoleNiche.js";
import { buildBrandSearchQueries, ensureBrandKeywords } from "./adConsoleKeywords.js";
import type { NicheStream } from "../db/schema.js";

// TikTok is keyword search (works well — view-ranked clips by query).
const TIKTOK_ACTOR = "clockworks~tiktok-scraper";

/**
 * Instagram reels by KEYWORD (no hashtags, no brand handles). Actor
 * `patient_discovery/instagram-search-reels` searches one `query` term and
 * paginates `maxPages`. NB: the input key is `query` (defaults to "trending" if
 * omitted — passing the wrong key silently returns generic trending reels).
 */
const IG_KEYWORD_SEARCH_ENABLED = true;
const IG_REELS_ACTOR = "TxU0ZBQIHdR20dr9C"; // patient_discovery/instagram-search-reels
const IG_QUERY_CAP = 10; // keywords (= actor runs) per IG pull
const IG_QUERY_CONCURRENCY = 4; // parallel actor runs
// Adaptive paging: every keyword is crawled to IG_BASE_PAGES first; the page
// budget that exhausted keywords leave on the table is spent deepening the
// most-productive keywords to IG_DEEP_PAGES — so the *average* lands at 4 pages
// ((BASE+DEEP)/2) without wasting crawls on keywords that have nothing more.
const IG_BASE_PAGES = 2; // ≈24 reels
const IG_DEEP_PAGES = 6; // ≈72 reels for productive keywords
const IG_FULL_PAGE_REELS = 11; // ~per-page yield; a near-full last batch ⇒ more available
// IG virality gate (per operator rule): real shares + a watchable length, in
// place of the view floor — IG hides/understates views and shares is the
// stronger organic signal.
const IG_MIN_SHARES = 100;
// Operator rule: only clips ≥30s (long enough to be a real, mirror-worthy video).
export const ORGANIC_MIN_DURATION_SEC = 30;
// TikTok virality gate: saves/bookmarks (the strongest "I'll come back to this"
// signal). Views are ignored per operator rule.
const TIKTOK_MIN_BOOKMARKS = 100;

// Widen the TikTok net (more angle queries + deeper results per query) so more
// >100K-view clips surface. Applied directly here so it doesn't require editing
// the per-niche stored config.
const TIKTOK_QUERY_CAP = 14;
const TIKTOK_RESULTS_PER_QUERY = 100; // deeper crawl so the strict bookmark gate still surfaces clips on sparse keywords

/** Trending floor (spec / operator rule): organic posts must clear 100K views. */
export const MIN_ORGANIC_VIEWS = 100_000;

type Caps = NicheStreamConfig["caps"];

// ── English-only gate (operator rule) ────────────────────────────────────────
// Non-Latin scripts that are definitively not English: Cyrillic, Hebrew, Arabic,
// Devanagari, Thai, Hiragana/Katakana, CJK, Hangul.
const NON_LATIN_RE =
  /[Ѐ-ӿ֐-׿؀-ۿऀ-ॿ฀-๿぀-ヿ㐀-鿿가-힯]/g;
const EN_STOPWORDS = new Set(
  "the an and or but is are was to of in on for with this that you your my how why what when best not no do does have has get got just really love like make new review tips routine try need want about from can will good great use".split(" "),
);
// Function words that strongly mark a NON-English Latin language (es / pt / fr / de / it).
const FOREIGN_STOPWORDS = new Set([
  "que", "de", "la", "el", "los", "las", "una", "con", "por", "para", "pero", "muy", "más", "como", "esta", "este", "piel", "protector", "solar", "crema",
  "da", "do", "uma", "você", "pele", "protetor", "filtro", "não", "mais", "muito",
  "les", "des", "une", "avec", "pour", "très", "cette", "peau", "crème", "solaire", "vous", "pas", "ne", "est",
  "der", "die", "das", "und", "ein", "eine", "mit", "für", "aber", "sehr", "wie", "haut", "sonnencreme", "nicht", "ich", "auch",
  "di", "ma", "molto", "più", "questa", "pelle", "non", "sono",
]);

/**
 * Lightweight English detector for organic captions — dependency-free and biased
 * to KEEP when unsure, so English clips are never dropped. A clip is filtered out
 * only when the caption is in a non-Latin script (≥4 non-Latin chars) or is
 * clearly a Latin non-English language (≥2 foreign function words and no English
 * ones). Hashtag/emoji-only or very short captions are kept (the search keyword
 * was English, so they're English-targeted).
 */
export function isLikelyEnglish(caption: string | null | undefined): boolean {
  if (!caption) return true;
  const cleaned = caption
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#][\w.]+/g, " ")
    .toLowerCase();
  if ((cleaned.match(NON_LATIN_RE) ?? []).length >= 4) return false;
  const words = (cleaned.match(/[a-zà-öø-ÿ]+/g) ?? []).filter((w) => w.length >= 2);
  if (words.length < 3) return true; // too little text to judge
  let en = 0;
  let foreign = 0;
  for (const w of words) {
    if (EN_STOPWORDS.has(w)) en++;
    else if (FOREIGN_STOPWORDS.has(w)) foreign++;
  }
  if (en > 0 && en >= foreign) return true;
  if (foreign >= 2 && foreign > en) return false;
  return true; // ambiguous → keep
}

/**
 * The view count we gate + score on. IG often hides the play count and returns
 * only likes; we estimate views ≈ likes × 10 (~10% like-rate) so a strong reel
 * with a hidden view count still qualifies. Shared with the ranker.
 */
export function effectiveOrganicViews(views: number | null, likes: number | null): number {
  if (typeof views === "number" && views > 0) return views;
  if (typeof likes === "number" && likes > 0) return likes * 10;
  return 0;
}

/** Normalize a social handle for set membership: strip leading @, lowercase. */
export function normalizeHandleKey(handle: string | null | undefined): string {
  return (handle ?? "").replace(/^@+/, "").trim().toLowerCase();
}

export type OrganicIngestResult = {
  queriesRun: number;
  itemsSeen: number;
  inserted: number;
  updated: number;
  skipped: number;
};

function emptyResult(): OrganicIngestResult {
  return { queriesRun: 0, itemsSeen: 0, inserted: 0, updated: 0, skipped: 0 };
}

function mergeResult(into: OrganicIngestResult, from: OrganicIngestResult): void {
  into.queriesRun += from.queriesRun;
  into.itemsSeen += from.itemsSeen;
  into.inserted += from.inserted;
  into.updated += from.updated;
  into.skipped += from.skipped;
}

function resolveCaps(stream?: NicheStream | null): Caps {
  const cfg = (stream?.config ?? null) as Partial<NicheStreamConfig> | null;
  const caps = cfg?.caps;
  if (caps && typeof caps.organicPerQuery === "number") return caps as Caps;
  return DEFAULT_NICHE_CONFIG.caps;
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

/** True if any of the keys is a truthy boolean / "true" / 1 — used for ad flags. */
function pickBool(obj: Record<string, unknown>, keys: string[]): boolean {
  for (const k of keys) {
    const v = obj[k];
    if (v === true || v === 1) return true;
    if (typeof v === "string" && v.trim().toLowerCase() === "true") return true;
  }
  return false;
}

function parsePostDate(v: unknown): Date | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v; // seconds ⇒ ms
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string" && v.trim()) {
    const s = v.trim();
    if (/^\d+$/.test(s)) return parsePostDate(Number(s));
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Normalize hashtags that arrive as string[] or as objects like { name }. */
function normalizeHashtags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const h of v) {
    let tag = "";
    if (typeof h === "string") tag = h;
    else if (h && typeof h === "object") tag = pickStr(h as Record<string, unknown>, ["name", "title", "hashtag"]);
    tag = tag.trim().replace(/^#+/, "");
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

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

// ── Apify transport ─────────────────────────────────────────────────────────

async function runApifyActor(actorPath: string, input: unknown, timeoutMs = 180_000): Promise<Record<string, unknown>[]> {
  if (!env.APIFY_TOKEN) throw new Error("APIFY_TOKEN not set");
  const url = `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?token=${encodeURIComponent(env.APIFY_TOKEN)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
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
    throw new Error(`Apify run failed (${actorPath} ${res.status}): ${detail.slice(0, 300)}`);
  }
  const items = (await res.json()) as unknown;
  if (!Array.isArray(items)) throw new Error(`Apify run returned a non-array dataset (${actorPath})`);
  return items as Record<string, unknown>[];
}

// ── Normalization ───────────────────────────────────────────────────────────

type NormalizedOrganic = {
  source: "instagram" | "tiktok";
  externalId: string;
  handle: string | null;
  profileName: string | null;
  postUrl: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  hashtags: string[];
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  /** Saves/bookmarks — the TikTok virality gate (collectCount). */
  bookmarks: number | null;
  postedAt: Date | null;
  transcript: string | null;
  /** Sponsored / paid-partnership / branded-content flag — these are filtered out. */
  isAd: boolean;
  /** "video" (reel/clip) or "image" — the organic rail keeps videos only. */
  format: "video" | "image";
  /** Clip length in seconds (null when unknown) — IG gate drops sub-10s reels. */
  durationSec: number | null;
  raw: Record<string, unknown>;
};

function normalizeTiktok(raw: Record<string, unknown>): NormalizedOrganic | null {
  const externalId = pickStr(raw, ["id", "videoId", "awemeId"]);
  if (!externalId) return null;
  const author = (raw.authorMeta && typeof raw.authorMeta === "object" ? raw.authorMeta : {}) as Record<string, unknown>;
  const videoMeta = (raw.videoMeta && typeof raw.videoMeta === "object" ? raw.videoMeta : {}) as Record<string, unknown>;
  return {
    source: "tiktok",
    externalId,
    handle: pickStr(author, ["name", "uniqueId"]) || pickStr(raw, ["authorUniqueId"]) || null,
    profileName: pickStr(author, ["nickName", "nickname"]) || null,
    postUrl: pickStr(raw, ["webVideoUrl", "postPage", "url"]) || null,
    mediaUrl: pickStr(raw, ["videoUrl", "mediaUrl", "downloadAddr"]) || pickStr(videoMeta, ["downloadAddr"]) || null,
    thumbnailUrl: pickStr(videoMeta, ["coverUrl", "originCover", "cover"]) || pickStr(raw, ["covers", "cover"]) || null,
    caption: pickStr(raw, ["text", "desc", "caption"]) || null,
    hashtags: normalizeHashtags(raw.hashtags),
    views: pickNum(raw, ["playCount", "viewCount"]),
    likes: pickNum(raw, ["diggCount", "likeCount"]),
    comments: pickNum(raw, ["commentCount"]),
    shares: pickNum(raw, ["shareCount"]),
    bookmarks: pickNum(raw, ["collectCount", "saveCount", "bookmarkCount"]),
    postedAt: parsePostDate(raw.createTimeISO ?? raw.createTime),
    transcript: null, // TikTok transcript is a deferred paid add-on
    isAd: pickBool(raw, ["isAd", "isSponsored", "isCommerce"]),
    format: "video", // TikTok search returns clips (slideshows render in the embed too)
    durationSec: pickNum(videoMeta, ["duration"]) ?? pickNum(raw, ["videoDuration", "duration"]),
    raw,
  };
}

/**
 * Normalize one reel from patient_discovery/instagram-search-reels — IG-native
 * snake_case fields (play_count / share_count / video_duration / is_video / …).
 */
function normalizeIgSearchReel(raw: Record<string, unknown>): NormalizedOrganic | null {
  const code = pickStr(raw, ["code", "shortcode", "short_code"]);
  const externalId = code || pickStr(raw, ["id", "pk", "fbid"]);
  if (!externalId) return null;
  const user = (raw.user && typeof raw.user === "object" ? raw.user : {}) as Record<string, unknown>;
  const captionRaw = raw.caption;
  const caption =
    typeof captionRaw === "string"
      ? captionRaw
      : captionRaw && typeof captionRaw === "object"
        ? pickStr(captionRaw as Record<string, unknown>, ["text"])
        : "";
  // image_versions → thumbnail fallback when thumbnail_url is absent.
  const imageVersions = (raw.image_versions ?? raw.image_versions2) as Record<string, unknown> | undefined;
  const ivItems = imageVersions && Array.isArray((imageVersions as { items?: unknown }).items)
    ? ((imageVersions as { items: Record<string, unknown>[] }).items)
    : Array.isArray((imageVersions as { candidates?: unknown })?.candidates)
      ? ((imageVersions as { candidates: Record<string, unknown>[] }).candidates)
      : [];
  const sponsorTags = Array.isArray(raw.sponsor_tags) ? raw.sponsor_tags.length > 0 : false;
  return {
    source: "instagram",
    externalId,
    handle: pickStr(user, ["username"]) || null,
    profileName: pickStr(user, ["full_name", "fullName"]) || null,
    postUrl: code ? `https://www.instagram.com/reel/${code}/` : null,
    mediaUrl: pickStr(raw, ["video_url"]) || null,
    thumbnailUrl: pickStr(raw, ["thumbnail_url"]) || (ivItems[0] ? pickStr(ivItems[0], ["url"]) : "") || null,
    caption: caption || null,
    hashtags: (caption.match(/#\w+/g) ?? []).map((h) => h.replace(/^#/, "")),
    views: pickNum(raw, ["play_count", "ig_play_count", "view_count"]),
    likes: pickNum(raw, ["like_count"]),
    comments: pickNum(raw, ["comment_count"]),
    shares: pickNum(raw, ["share_count", "reshare_count"]),
    bookmarks: pickNum(raw, ["save_count", "saved_count"]),
    postedAt: parsePostDate(raw.taken_at ?? raw.taken_at_ts ?? raw.device_timestamp),
    transcript: null,
    isAd: pickBool(raw, ["is_paid_partnership"]) || sponsorTags,
    format: pickBool(raw, ["is_video"]) || Boolean(pickStr(raw, ["video_url"])) ? "video" : "image",
    durationSec: pickNum(raw, ["video_duration"]),
    raw,
  };
}

// ── Traction scoring ────────────────────────────────────────────────────────

/** The raw public metrics an organic post is scored on — shared by ingest + rank. */
export type OrganicMetrics = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  postedAt: Date | null;
};

/**
 * Intrinsic 0..1 traction for an organic post: reach-normalized views
 * (dominant), engagement rate, and recency. Falls back to likes as a view
 * proxy when the scraper hides the view count (IG sometimes does).
 *
 * Views curve is STEEP on purpose (spec §4 "trending"): sub-1K-view posts score
 * ~0 so a low-reach clip can't ride keyword-relevance to the top of the feed —
 * "trending" is fundamentally about reach. 1K→0, 10K→0.33, 100K→0.67, 1M→1.0.
 * Exported so the ranker can recompute live from a pooled row's stored metrics
 * (re-tuning the curve only needs a re-rank, not a fresh Apify pull).
 */
export function scoreOrganicTraction(m: OrganicMetrics, caps: Caps): number {
  const views = Math.max(0, m.views ?? 0);
  const likes = Math.max(0, m.likes ?? 0);
  const viewsScore =
    views > 0
      ? Math.max(0, Math.min((Math.log10(views) - 3) / 3, 1))
      : likes > 0
        ? Math.max(0, Math.min((Math.log10(likes) - 2) / 3, 1)) * 0.8 // likes-only ⇒ weaker proxy
        : 0;

  const engNumer = likes + Math.max(0, m.comments ?? 0) + Math.max(0, m.shares ?? 0);
  const engDenom = views > 0 ? views : likes > 0 ? likes * 10 : 0; // rough impression proxy
  const engScore = engDenom > 0 ? Math.min(engNumer / engDenom / 0.1, 1) : 0; // 10% rate ⇒ 1.0

  const window = caps.organicRecencyDays || 60;
  let recencyScore = 0.5; // neutral when the post date is unknown
  if (m.postedAt) {
    const ageDays = (Date.now() - m.postedAt.getTime()) / 86_400_000;
    recencyScore = Math.max(0, Math.min((window - ageDays) / window, 1));
  }

  const score = 0.55 * viewsScore + 0.3 * engScore + 0.15 * recencyScore;
  return Math.round(Math.max(0, Math.min(score, 1)) * 10_000) / 10_000;
}

// ── Persistence ─────────────────────────────────────────────────────────────

/**
 * Upsert one post into the global pool, keyed by (source, external_id).
 * Provenance (niche_stream_id) is first-writer-wins; the volatile metrics +
 * traction score are refreshed on re-pull.
 */
async function upsertOrganicPost(
  post: NormalizedOrganic,
  nicheStreamId: string | null,
  caps: Caps,
  brandHandles: Set<string>,
): Promise<"inserted" | "updated" | "skipped"> {
  // Recency gate: only applied when a POSITIVE window is configured. 0 / unset =
  // no limit (operator rule) — the best evergreen clips are often old, so we keep
  // them and let engagement (saves/shares) decide.
  const recencyDays = caps.organicRecencyDays ?? 0;
  if (recencyDays > 0 && post.postedAt) {
    const ageDays = (Date.now() - post.postedAt.getTime()) / 86_400_000;
    if (ageDays > recencyDays) return "skipped";
  }

  // Shared quality gates: videos only, no ads/paid-partnership, no posts authored
  // by a known brand (competitors + leading advertisers).
  if (post.format !== "video") return "skipped";
  if (post.isAd) return "skipped";
  // English-only feed (operator rule): drop non-English captions.
  if (!isLikelyEnglish(post.caption)) return "skipped";
  const handleKey = normalizeHandleKey(post.handle);
  if (handleKey && brandHandles.has(handleKey)) return "skipped";

  // Watchable-length gate applies to BOTH platforms (operator rule: ≥30s).
  if ((post.durationSec ?? 0) < ORGANIC_MIN_DURATION_SEC) return "skipped";
  // Per-platform virality bar (views ignored on both — engagement is the signal):
  //  - Instagram: ≥100 shares.
  //  - TikTok: ≥100 saves/bookmarks.
  if (post.source === "instagram") {
    if ((post.shares ?? 0) < IG_MIN_SHARES) return "skipped";
  } else {
    if ((post.bookmarks ?? 0) < TIKTOK_MIN_BOOKMARKS) return "skipped";
  }

  const tractionScore = scoreOrganicTraction(post, caps);

  const [insertedRow] = await db
    .insert(schema.organicPosts)
    .values({
      source: post.source,
      externalId: post.externalId,
      handle: post.handle,
      profileName: post.profileName,
      postUrl: post.postUrl,
      mediaUrl: post.mediaUrl,
      thumbnailUrl: post.thumbnailUrl,
      caption: post.caption,
      hashtags: post.hashtags,
      views: post.views,
      likes: post.likes,
      comments: post.comments,
      shares: post.shares,
      bookmarks: post.bookmarks,
      durationSec: post.durationSec != null ? Math.round(post.durationSec) : null,
      postedAt: post.postedAt,
      transcript: post.transcript,
      format: "video",
      tractionScore: String(tractionScore),
      nicheStreamId,
      rawJson: post.raw,
    })
    .onConflictDoNothing({ target: [schema.organicPosts.source, schema.organicPosts.externalId] })
    .returning({ id: schema.organicPosts.id });

  if (insertedRow) return "inserted";

  await db
    .update(schema.organicPosts)
    .set({
      handle: post.handle,
      profileName: post.profileName,
      postUrl: post.postUrl,
      mediaUrl: post.mediaUrl,
      thumbnailUrl: post.thumbnailUrl,
      caption: post.caption,
      hashtags: post.hashtags,
      views: post.views,
      likes: post.likes,
      comments: post.comments,
      shares: post.shares,
      bookmarks: post.bookmarks,
      durationSec: post.durationSec != null ? Math.round(post.durationSec) : null,
      postedAt: post.postedAt,
      // Only fill a transcript we now have — never wipe one a prior pull captured.
      ...(post.transcript ? { transcript: post.transcript } : {}),
      tractionScore: String(tractionScore),
      rawJson: post.raw,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.organicPosts.source, post.source), eq(schema.organicPosts.externalId, post.externalId)));

  return "updated";
}

async function ingestNormalized(
  items: Record<string, unknown>[],
  normalize: (raw: Record<string, unknown>) => NormalizedOrganic | null,
  nicheStreamId: string | null,
  caps: Caps,
  result: OrganicIngestResult,
  brandHandles: Set<string>,
): Promise<void> {
  for (const raw of items) {
    result.itemsSeen++;
    const post = normalize(raw);
    if (!post) {
      result.skipped++;
      continue;
    }
    const outcome = await upsertOrganicPost(post, nicheStreamId, caps, brandHandles);
    if (outcome === "inserted") result.inserted++;
    else if (outcome === "updated") result.updated++;
    else result.skipped++;
  }
}

// ── Platform ingest ─────────────────────────────────────────────────────────

/** Run `fn` over `items` with bounded concurrency. */
async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    out.push(...(await Promise.all(items.slice(i, i + concurrency).map(fn))));
  }
  return out;
}

/**
 * Instagram reels by KEYWORD (no hashtags, no brand handles). The actor takes a
 * single `query`, so we run one search per angle phrase (bounded concurrency)
 * and merge. Brand-authored + ad + sub-threshold reels are filtered downstream.
 */
async function ingestInstagramSearch(
  queries: string[],
  nicheStreamId: string | null,
  caps: Caps,
  brandHandles: Set<string>,
): Promise<OrganicIngestResult> {
  const result = emptyResult();
  if (!IG_KEYWORD_SEARCH_ENABLED) return result;

  const terms = dedupCI(queries.filter((q) => q.trim().length >= 3)).slice(0, IG_QUERY_CAP);
  if (terms.length === 0) return result;

  const crawl = (query: string, pages: number): Promise<Record<string, unknown>[]> =>
    runApifyActor(IG_REELS_ACTOR, { query, maxPages: pages }).catch((err) => {
      console.error(`[ad-console] IG reels pull failed for "${query}":`, err);
      return [] as Record<string, unknown>[];
    });

  // Phase 1: crawl every keyword to the base depth (parallel).
  const states = await mapPool(terms, IG_QUERY_CONCURRENCY, async (query) => ({
    query,
    items: await crawl(query, IG_BASE_PAGES),
    pages: IG_BASE_PAGES,
  }));

  // Phase 2: spend the leftover page budget deepening the most-productive
  // keywords (those whose base crawl came back near-full → more available) to
  // IG_DEEP_PAGES. Deepening half of them lands the average at 4 pages; sparse
  // keywords stay at the base instead of wasting crawls.
  const deepenTargets = states
    .filter((s) => s.items.length >= IG_BASE_PAGES * IG_FULL_PAGE_REELS)
    .sort((a, b) => b.items.length - a.items.length)
    .slice(0, Math.floor(terms.length / 2));
  await mapPool(deepenTargets, IG_QUERY_CONCURRENCY, async (s) => {
    s.items = await crawl(s.query, IG_DEEP_PAGES);
    s.pages = IG_DEEP_PAGES;
  });

  for (const s of states) {
    result.queriesRun++;
    // Tag each reel with the query that surfaced it (mirrors TikTok's
    // `searchQuery`) — the ranker uses this as the relevance signal.
    for (const it of s.items) it.searchQuery = s.query;
    const before = result.inserted + result.updated;
    await ingestNormalized(s.items, normalizeIgSearchReel, nicheStreamId, caps, result, brandHandles);
    const qualified = result.inserted + result.updated - before;
    console.log(`[ad-console] IG "${s.query}" (${s.pages}pg): ${s.items.length} crawled → ${qualified} qualified`);
  }
  const avgPages = states.reduce((n, s) => n + s.pages, 0) / states.length;
  console.log(`[ad-console] IG reels total: ${result.inserted + result.updated} qualified / ${result.itemsSeen} crawled (avg ${avgPages.toFixed(1)} pages/keyword)`);
  return result;
}

/** Scrape TikTok by KEYWORD search over the brand's angle phrases + niche terms. */
async function ingestTiktok(
  searchQueries: string[],
  nicheStreamId: string | null,
  caps: Caps,
  brandHandles: Set<string>,
): Promise<OrganicIngestResult> {
  const result = emptyResult();
  const queries = dedupCI(searchQueries).slice(0, TIKTOK_QUERY_CAP);
  if (queries.length === 0) return result;

  let items: Record<string, unknown>[];
  try {
    items = await runApifyActor(TIKTOK_ACTOR, { searchQueries: queries, resultsPerPage: TIKTOK_RESULTS_PER_QUERY });
  } catch (err) {
    console.error("[ad-console] TikTok pull failed:", err);
    return result;
  }
  result.queriesRun++;

  // Group the merged dataset back by the `searchQuery` each item came from, so
  // we can report crawled→qualified per keyword.
  const byQuery = new Map<string, Record<string, unknown>[]>();
  for (const it of items) {
    const q = typeof it.searchQuery === "string" && it.searchQuery.trim() ? it.searchQuery : "(other)";
    const bucket = byQuery.get(q);
    if (bucket) bucket.push(it);
    else byQuery.set(q, [it]);
  }
  for (const [q, group] of Array.from(byQuery)) {
    const before = result.inserted + result.updated;
    await ingestNormalized(group, normalizeTiktok, nicheStreamId, caps, result, brandHandles);
    const qualified = result.inserted + result.updated - before;
    console.log(`[ad-console] TikTok "${q}": ${group.length} crawled → ${qualified} qualified`);
  }
  console.log(`[ad-console] TikTok total: ${result.inserted + result.updated} qualified / ${result.itemsSeen} crawled`);
  return result;
}

export type OrganicScope = "instagram" | "tiktok" | "all";

/**
 * Niche-scoped organic pull. BOTH platforms are keyword-driven by the SAME pool:
 * the brand's problem/outcome angle phrases LEAD, then the niche's organic +
 * pain-point terms fill (no hashtags, no product keywords — we want pure organic
 * problem/symptom language). `brandHandles` is the exclusion set (competitors +
 * leading advertisers) — organic must be creator content, never brand-posted.
 */
export async function ingestNicheOrganic(
  stream: NicheStream,
  brandHandles: Set<string>,
  scope: OrganicScope = "all",
  brandOrganicQueries: string[] = [],
): Promise<{ instagram: OrganicIngestResult | null; tiktok: OrganicIngestResult | null }> {
  const caps = resolveCaps(stream);
  const kw = (stream.keywords ?? {}) as { organic?: unknown };
  const painPoints = Array.isArray(stream.painPointKeywords)
    ? (stream.painPointKeywords as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const organicTerms = Array.isArray(kw.organic) ? (kw.organic as unknown[]).filter((x): x is string => typeof x === "string") : [];
  // One unified, problem-based query pool for both platforms.
  const queries = [...brandOrganicQueries, ...organicTerms, ...painPoints];

  let instagram: OrganicIngestResult | null = null;
  let tiktok: OrganicIngestResult | null = null;

  if (scope === "all" || scope === "instagram") {
    instagram = await ingestInstagramSearch(queries, stream.id, caps, brandHandles);
  }
  if (scope === "all" || scope === "tiktok") {
    tiktok = await ingestTiktok(queries, stream.id, caps, brandHandles);
  }
  return { instagram, tiktok };
}

export type BrandOrganicIngestSummary = {
  niche: string | null;
  seeded: boolean;
  instagram: OrganicIngestResult | null;
  tiktok: OrganicIngestResult | null;
};

/**
 * Brand-level manual organic pull. Organic content is niche-scoped, so this
 * needs a seeded niche stream; for an unseeded niche ("other") it returns a
 * summary with null results and seeded=false. Throws PromptNotConfiguredError /
 * "no products" up to the route (→ 424) when niche detection can't run.
 */
export async function ingestBrandOrganic(brandId: string, scope: OrganicScope = "all"): Promise<BrandOrganicIngestSummary> {
  const state = await ensureBrandNiche(brandId);
  if (!state.stream) {
    return { niche: state.nicheType, seeded: state.seeded, instagram: null, tiktok: null };
  }

  // Build the brand-EXCLUSION set so organic stays creator content: the brand's
  // competitors (any status) + the niche's leading advertisers, by IG + TikTok
  // handle. A post authored by any of these is dropped at ingest.
  const brandHandles = new Set<string>();
  for (const c of await listCompetitors(brandId)) {
    for (const h of [c.igHandle, c.tiktokHandle]) {
      const k = normalizeHandleKey(h);
      if (k) brandHandles.add(k);
    }
  }
  const advertisers = Array.isArray(state.stream.leadingAdvertisers)
    ? (state.stream.leadingAdvertisers as { igHandle?: unknown; tiktokHandle?: unknown }[])
    : [];
  for (const a of advertisers) {
    for (const h of [a.igHandle, a.tiktokHandle]) {
      const k = normalizeHandleKey(typeof h === "string" ? h : null);
      if (k) brandHandles.add(k);
    }
  }

  // #137: auto-extract the brand's angle keywords (LLM-only, idempotent) and let
  // the problem/outcome phrases DRIVE the IG + TikTok keyword search.
  await ensureBrandKeywords(brandId);
  const { organicQueries } = await buildBrandSearchQueries(brandId);

  const { instagram, tiktok } = await ingestNicheOrganic(state.stream, brandHandles, scope, organicQueries);

  console.log(
    `[ad-console] brand ${brandId} organic ingest (scope=${scope}): ` +
      `ig=${instagram ? `${instagram.inserted}+/${instagram.updated}~` : "—"} ` +
      `tiktok=${tiktok ? `${tiktok.inserted}+/${tiktok.updated}~` : "—"}`,
  );

  return { niche: state.nicheType, seeded: state.seeded, instagram, tiktok };
}
