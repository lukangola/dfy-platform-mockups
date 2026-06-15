/**
 * Ad Creative Console API.
 *
 * The operator-facing "command center" of proven competitor ads + trending
 * organic content, scoped to the active brand's niche. Access is managers +
 * admins on ANY brand (no per-brand membership gate) — the same audience as the
 * Client Console, enforced here with `requireManager`.
 *
 * Phase 0 surface (this file will grow per build phase):
 *   GET  /api/ad-console/brands/:brandId/niche        — current niche state
 *   POST /api/ad-console/brands/:brandId/detect-niche — (re)classify the brand
 */
import { type Request, type Response, Router } from "express";
import { requireAuth, requireManager } from "../lib/auth.js";
import { PromptNotConfiguredError } from "../lib/prompts.js";
import { isApifyConfigured } from "../lib/apify.js";
import { isGethookdConfigured } from "../lib/gethookd.js";
import { detectBrandNiche, getBrandNicheState } from "../lib/adConsoleNiche.js";
import { ensureBrandConsoleReady } from "../lib/adConsoleBootstrap.js";
import {
  addManualCompetitor,
  deleteCompetitor,
  discoverCompetitors,
  listCompetitors,
  updateCompetitor,
} from "../lib/adConsoleCompetitors.js";
import { ingestBrandAds } from "../lib/adConsoleAds.js";
import { ingestBrandOrganic } from "../lib/adConsoleOrganic.js";
import {
  findProductAngle,
  listBrandKeywordSets,
  runKeywordExtract,
  startKeywordExtract,
} from "../lib/adConsoleKeywords.js";
import { listBrandFeed, rankBrandFeed } from "../lib/adConsoleFeed.js";
import { selectFeedItem, skipFeedItem } from "../lib/adConsoleBrief.js";
import { getFeedPullRun, startFeedPull } from "../lib/adConsolePull.js";
import { generateWeeklyIdeas, getLatestIdeaBatch, setIdeaStatus } from "../lib/adConsoleIdeas.js";

export const adConsoleRouter: Router = Router();

// Every Ad Console endpoint requires an authenticated manager or admin.
adConsoleRouter.use(requireAuth, requireManager);

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

// Social-CDN hosts the image proxy is allowed to fetch (SSRF guard).
const PROXY_HOST_RE =
  /(^|\.)(cdninstagram\.com|fbcdn\.net|tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com|tiktokcdn-in\.com)$/i;

/**
 * GET /api/ad-console/img?url=<encoded>
 * Same-origin image proxy for organic thumbnails. Instagram's CDN serves covers
 * with `Cross-Origin-Resource-Policy: same-origin`, so the browser refuses to
 * paint them in our <img> (they render black). We re-fetch server-side (no CORP
 * enforcement) and stream the bytes back from our own origin. Host-allowlisted
 * to the social CDNs so it can't be used as an open proxy.
 */
adConsoleRouter.get("/img", async (req: Request, res: Response) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return res.status(400).end();
  }
  if (!PROXY_HOST_RE.test(host)) return res.status(400).end();
  try {
    // No Referer — these CDNs serve the bytes to any server-side fetch (the
    // browser-only CORP header is what we're working around), and a wrong
    // referer would just risk a 403 on the non-matching CDN.
    const upstream = await fetch(url);
    if (!upstream.ok) return res.status(502).end();
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
});

/**
 * GET /api/ad-console/brands/:brandId/niche
 * Returns the brand's detected niche, whether it maps to a configured stream,
 * and the attached niche_streams row (materialized on demand).
 */
adConsoleRouter.get("/brands/:brandId/niche", async (req: Request, res: Response) => {
  try {
    const state = await getBrandNicheState(req.params.brandId);
    res.json(state);
  } catch (err) {
    console.error("[ad-console] get niche failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/ad-console/brands/:brandId/detect-niche
 * Classifies the brand from its products + research and persists the result.
 * 424 when there's nothing to classify yet (no products / research) or the
 * classifier prompt isn't configured.
 */
adConsoleRouter.post("/brands/:brandId/detect-niche", async (req: Request, res: Response) => {
  try {
    const classification = await detectBrandNiche(req.params.brandId);
    const state = await getBrandNicheState(req.params.brandId);
    res.json({ classification, state });
  } catch (err) {
    if (err instanceof PromptNotConfiguredError) {
      return sendError(res, 424, err.message);
    }
    const msg = err instanceof Error ? err.message : String(err);
    // "no products to classify" is a user-actionable precondition, not a 500.
    if (/no products to classify/i.test(msg)) {
      return sendError(res, 424, msg);
    }
    console.error("[ad-console] detect niche failed:", err);
    sendError(res, 500, msg);
  }
});

/**
 * POST /api/ad-console/brands/:brandId/bootstrap
 * Background "make this brand Console-ready": auto-detect niche, auto-research
 * ~10 competitors when the watchlist is empty, and extract angle keywords —
 * all LLM-only (no Apify spend). Idempotent + in-flight-deduped, so the client
 * can fire it on every Console load. Returns a per-step summary; individual
 * step failures are reported in `errors` rather than failing the request.
 */
adConsoleRouter.post("/brands/:brandId/bootstrap", async (req: Request, res: Response) => {
  try {
    const summary = await ensureBrandConsoleReady(req.params.brandId);
    res.json(summary);
  } catch (err) {
    console.error("[ad-console] bootstrap failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── Competitors (Phase 1) ──────────────────────────────────────────────────

/** GET /api/ad-console/brands/:brandId/competitors — list, oldest first. */
adConsoleRouter.get("/brands/:brandId/competitors", async (req: Request, res: Response) => {
  try {
    const competitors = await listCompetitors(req.params.brandId);
    res.json({ competitors });
  } catch (err) {
    console.error("[ad-console] list competitors failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/ad-console/brands/:brandId/competitors — manually add one.
 * Body: { name, fbPageUrl?, fbPageId?, igHandle?, tiktokHandle? }
 * Idempotent: a duplicate (by dedupe key) returns the existing row with 200.
 */
adConsoleRouter.post("/brands/:brandId/competitors", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      name?: string;
      fbPageUrl?: string | null;
      fbPageId?: string | null;
      igHandle?: string | null;
      tiktokHandle?: string | null;
    };
    if (!body.name || !body.name.trim()) return sendError(res, 400, "Competitor name is required");
    const userId = req.auth?.user.id ?? null;
    const { competitor, created } = await addManualCompetitor(
      req.params.brandId,
      {
        name: body.name,
        fbPageUrl: body.fbPageUrl,
        fbPageId: body.fbPageId,
        igHandle: body.igHandle,
        tiktokHandle: body.tiktokHandle,
      },
      userId,
    );
    res.status(created ? 201 : 200).json({ competitor, created });
  } catch (err) {
    console.error("[ad-console] add competitor failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/ad-console/brands/:brandId/competitors/discover — LLM web_search
 * discovery. Synchronous (single research call); only ADDS new competitors,
 * never overwrites manual entries. 424 when the brand has no products yet or
 * the discovery prompt isn't configured.
 */
adConsoleRouter.post("/brands/:brandId/competitors/discover", async (req: Request, res: Response) => {
  try {
    const result = await discoverCompetitors(req.params.brandId);
    res.json(result);
  } catch (err) {
    if (err instanceof PromptNotConfiguredError) return sendError(res, 424, err.message);
    const msg = err instanceof Error ? err.message : String(err);
    if (/no products/i.test(msg)) return sendError(res, 424, msg);
    console.error("[ad-console] discover competitors failed:", err);
    sendError(res, 500, msg);
  }
});

/** PATCH /api/ad-console/competitors/:id — edit fields or archive/unarchive. */
adConsoleRouter.patch("/competitors/:id", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      name?: string;
      fbPageUrl?: string | null;
      fbPageId?: string | null;
      igHandle?: string | null;
      tiktokHandle?: string | null;
      status?: string;
    };
    const updated = await updateCompetitor(req.params.id, body);
    if (!updated) return sendError(res, 404, "Competitor not found");
    res.json({ competitor: updated });
  } catch (err) {
    console.error("[ad-console] update competitor failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/** DELETE /api/ad-console/competitors/:id — remove one. */
adConsoleRouter.delete("/competitors/:id", async (req: Request, res: Response) => {
  try {
    const ok = await deleteCompetitor(req.params.id);
    if (!ok) return sendError(res, 404, "Competitor not found");
    res.json({ ok: true });
  } catch (err) {
    console.error("[ad-console] delete competitor failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── Keyword sets (Phase 2) ──────────────────────────────────────────────────

/**
 * GET /api/ad-console/brands/:brandId/keyword-sets — all per-angle keyword sets
 * for the brand (oldest first). The Console polls this for status + results.
 */
adConsoleRouter.get("/brands/:brandId/keyword-sets", async (req: Request, res: Response) => {
  try {
    const keywordSets = await listBrandKeywordSets(req.params.brandId);
    res.json({ keywordSets });
  } catch (err) {
    console.error("[ad-console] list keyword sets failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/ad-console/brands/:brandId/keyword-sets — extract keywords for ONE
 * angle. Body: { productId, angleId }. Flips/creates the (brand, angle) row to
 * `running` and returns it immediately; the LLM extraction runs in the
 * background and writes the terminal state. 404 when the angle can't be found.
 */
adConsoleRouter.post("/brands/:brandId/keyword-sets", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { productId?: string; angleId?: string };
    const productId = typeof body.productId === "string" ? body.productId : null;
    const angleId = typeof body.angleId === "string" ? body.angleId : null;
    if (!productId) return sendError(res, 400, "productId is required");
    if (!angleId) return sendError(res, 400, "angleId is required");

    const angle = await findProductAngle(productId, angleId);
    if (!angle) return sendError(res, 404, "Angle not found for this product");

    const row = await startKeywordExtract(req.params.brandId, productId, angle);
    // Fire-and-forget — the worker records its own terminal state on the row.
    void runKeywordExtract(req.params.brandId, productId, angle).catch((err) => {
      console.error("[ad-console] keyword extract worker crashed:", err);
    });
    res.status(202).json({ keywordSet: row });
  } catch (err) {
    if (err instanceof PromptNotConfiguredError) return sendError(res, 424, err.message);
    console.error("[ad-console] start keyword extract failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── Ad ingestion (Phase 3) ─────────────────────────────────────────────────

/**
 * POST /api/ad-console/brands/:brandId/ingest-ads — manual gethookd ad pull.
 * Body: { scope?: "niche" | "competitors" | "all" } (default "all").
 * Bounded by the niche stream's per-run caps; spends gethookd credits, so it
 * ONLY runs from this explicit operator action — never on boot/auto. 424 when
 * gethookd isn't configured, the brand has no products, or the classifier
 * prompt is missing (niche-scoped pulls need a classified brand).
 */
adConsoleRouter.post("/brands/:brandId/ingest-ads", async (req: Request, res: Response) => {
  try {
    if (!isGethookdConfigured()) {
      return sendError(res, 424, "GETHOOKD_API_KEY is not configured — set it before pulling ads.");
    }
    const scopeRaw = (req.body ?? {}).scope;
    const scope = scopeRaw === "niche" || scopeRaw === "competitors" ? scopeRaw : "all";
    const summary = await ingestBrandAds(req.params.brandId, scope);
    res.json(summary);
  } catch (err) {
    if (err instanceof PromptNotConfiguredError) return sendError(res, 424, err.message);
    const msg = err instanceof Error ? err.message : String(err);
    if (/no products/i.test(msg)) return sendError(res, 424, msg);
    console.error("[ad-console] ingest ads failed:", err);
    sendError(res, 500, msg);
  }
});

/**
 * POST /api/ad-console/brands/:brandId/ingest-organic — manual IG + TikTok pull.
 * Body: { scope?: "instagram" | "tiktok" | "all" } (default "all"). Organic is
 * niche-scoped: an unseeded niche returns null results. Same credit-safety +
 * 424 contract as ingest-ads.
 */
adConsoleRouter.post("/brands/:brandId/ingest-organic", async (req: Request, res: Response) => {
  try {
    if (!isApifyConfigured()) {
      return sendError(res, 424, "APIFY_TOKEN is not configured — set it before pulling organic content.");
    }
    const scopeRaw = (req.body ?? {}).scope;
    const scope = scopeRaw === "instagram" || scopeRaw === "tiktok" ? scopeRaw : "all";
    const summary = await ingestBrandOrganic(req.params.brandId, scope);
    res.json(summary);
  } catch (err) {
    if (err instanceof PromptNotConfiguredError) return sendError(res, 424, err.message);
    const msg = err instanceof Error ? err.message : String(err);
    if (/no products/i.test(msg)) return sendError(res, 424, msg);
    console.error("[ad-console] ingest organic failed:", err);
    sendError(res, 500, msg);
  }
});

// ── Feed ranking (Phase 5) ──────────────────────────────────────────────────

/**
 * POST /api/ad-console/brands/:brandId/rank-feed — (re)rank the brand's feed.
 * Deterministic + cheap: scores every pooled ad/organic the brand is eligible
 * for against its keywords and upserts `feed_items` (preserving swipe status).
 * Spends NO Apify credits and makes NO LLM call, so it's safe to call freely.
 */
adConsoleRouter.post("/brands/:brandId/rank-feed", async (req: Request, res: Response) => {
  try {
    const summary = await rankBrandFeed(req.params.brandId);
    res.json(summary);
  } catch (err) {
    console.error("[ad-console] rank feed failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * GET /api/ad-console/brands/:brandId/feed — the ranked queue, highest composite
 * first. Query: ?rail=competitor_ads|trending_organic, ?status=new|selected|skipped
 * (default "new"), ?limit=N. Each card carries the joined ad/organic payload.
 */
adConsoleRouter.get("/brands/:brandId/feed", async (req: Request, res: Response) => {
  try {
    const rail = typeof req.query.rail === "string" ? req.query.rail : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : undefined;
    const feed = await listBrandFeed(req.params.brandId, { rail, status, limit });
    res.json({ feed });
  } catch (err) {
    console.error("[ad-console] list feed failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── Make-it-mine / Skip + Creative Brief handoff (Phase 6, spec §11) ─────────

/**
 * POST /api/ad-console/brands/:brandId/feed/:feedItemId/select — "Make it mine".
 * Flips the item to `selected`, logs the swipe, and returns the normalized
 * Creative Brief + which recreation app should receive it (static → Static Ads
 * Recreator; transcript/copy-bearing → Script Rewriting). 404 if not found.
 */
adConsoleRouter.post("/brands/:brandId/feed/:feedItemId/select", async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.user.id ?? null;
    const result = await selectFeedItem(req.params.brandId, req.params.feedItemId, userId);
    if (!result) return sendError(res, 404, "Feed item not found");
    res.json({ brief: result.brief, item: result.item });
  } catch (err) {
    console.error("[ad-console] select feed item failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/ad-console/brands/:brandId/feed/:feedItemId/skip — "Skip".
 * Flips the item to `skipped` and logs the swipe. 404 if not found.
 */
adConsoleRouter.post("/brands/:brandId/feed/:feedItemId/skip", async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.user.id ?? null;
    const ok = await skipFeedItem(req.params.brandId, req.params.feedItemId, userId);
    if (!ok) return sendError(res, 404, "Feed item not found");
    res.json({ ok: true });
  } catch (err) {
    console.error("[ad-console] skip feed item failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── "Pull this week's feed" orchestration (Phase 6, spec §12.5–6) ─────────────

/**
 * POST /api/ad-console/brands/:brandId/pull-feed — the single operator button.
 * Chains ingest-ads → ingest-organic → rank-feed in the background and returns
 * immediately; the client polls the status endpoint below. Idempotent while a
 * run is in flight (`alreadyRunning=true`). Spends gethookd credits (ads) and
 * Apify credits (organic), so it ONLY fires from this explicit action and 424s
 * when either gethookd or Apify isn't configured.
 */
adConsoleRouter.post("/brands/:brandId/pull-feed", async (req: Request, res: Response) => {
  try {
    if (!isGethookdConfigured()) {
      return sendError(res, 424, "GETHOOKD_API_KEY is not configured — set it before pulling the feed (ads).");
    }
    if (!isApifyConfigured()) {
      return sendError(res, 424, "APIFY_TOKEN is not configured — set it before pulling the feed (organic).");
    }
    const { run, alreadyRunning } = startFeedPull(req.params.brandId);
    res.status(202).json({ run, alreadyRunning });
  } catch (err) {
    console.error("[ad-console] start pull-feed failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * GET /api/ad-console/brands/:brandId/pull-feed/status — current run snapshot for
 * the client poller. `{ run: null }` when no pull has run this process.
 */
adConsoleRouter.get("/brands/:brandId/pull-feed/status", async (req: Request, res: Response) => {
  try {
    const run = getFeedPullRun(req.params.brandId);
    res.json({ run });
  } catch (err) {
    console.error("[ad-console] get pull-feed status failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── "This Week's Ideas" — LLM-generated rail (Phase 5b, spec §5) ──────────────

/**
 * GET /api/ad-console/brands/:brandId/ideas — the brand's newest idea batch.
 * Returns the not-yet-actioned ideas the rail shows; ?includeActioned=true adds
 * the selected/skipped ones. `{ ideas: [] }` when none have been generated.
 */
adConsoleRouter.get("/brands/:brandId/ideas", async (req: Request, res: Response) => {
  try {
    const includeActioned = req.query.includeActioned === "true";
    const ideas = await getLatestIdeaBatch(req.params.brandId, { includeActioned });
    res.json({ ideas });
  } catch (err) {
    console.error("[ad-console] list ideas failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/ad-console/brands/:brandId/ideas/generate — generate a fresh batch
 * of LLM ad concepts grounded in the brand's keywords + its top-ranked pulled
 * creatives. Body: { count? } (1–16, default 8). Synchronous (one LLM call);
 * spends NO Apify credits. 424 when the prompt isn't configured.
 */
adConsoleRouter.post("/brands/:brandId/ideas/generate", async (req: Request, res: Response) => {
  try {
    const countRaw = (req.body ?? {}).count;
    const count = typeof countRaw === "number" && Number.isFinite(countRaw) ? countRaw : undefined;
    const result = await generateWeeklyIdeas(req.params.brandId, { count });
    res.json(result);
  } catch (err) {
    if (err instanceof PromptNotConfiguredError) return sendError(res, 424, err.message);
    console.error("[ad-console] generate ideas failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/** POST /api/ad-console/brands/:brandId/ideas/:ideaId/select — keep an idea. 404 if not found. */
adConsoleRouter.post("/brands/:brandId/ideas/:ideaId/select", async (req: Request, res: Response) => {
  try {
    const idea = await setIdeaStatus(req.params.brandId, req.params.ideaId, "selected");
    if (!idea) return sendError(res, 404, "Idea not found");
    res.json({ idea });
  } catch (err) {
    console.error("[ad-console] select idea failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/** POST /api/ad-console/brands/:brandId/ideas/:ideaId/skip — dismiss an idea. 404 if not found. */
adConsoleRouter.post("/brands/:brandId/ideas/:ideaId/skip", async (req: Request, res: Response) => {
  try {
    const idea = await setIdeaStatus(req.params.brandId, req.params.ideaId, "skipped");
    if (!idea) return sendError(res, 404, "Idea not found");
    res.json({ idea });
  } catch (err) {
    console.error("[ad-console] skip idea failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});
