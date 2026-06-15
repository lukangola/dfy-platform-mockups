/**
 * Ad Creative Console — "Pull this week's feed" orchestration (Phase 6 / spec
 * §12.5–6).
 *
 * Chains the three credit-/compute-bearing steps behind the single operator
 * button:  ingest ads → ingest organic → re-rank.  Because the Apify pulls are
 * slow (run-sync per query, minutes total), this runs ASYNC and the client
 * polls a status snapshot.
 *
 * Run state is kept IN-MEMORY (one run per brand) rather than in a table: it's
 * transient progress for a manual button on a single-instance dev tool, and a
 * server restart simply clears a stale "running" flag. The durable results land
 * in the pooled tables + `feed_items` as each step completes.
 *
 * CREDIT SAFETY: this only ever fires from the explicit operator route (never on
 * boot/auto). The route gates on `isApifyConfigured()` before a run can start.
 */
import { PromptNotConfiguredError } from "./prompts.js";
import { ingestBrandAds, type BrandAdIngestSummary } from "./adConsoleAds.js";
import { ingestBrandOrganic, type BrandOrganicIngestSummary } from "./adConsoleOrganic.js";
import { rankBrandFeed, type FeedRankSummary } from "./adConsoleFeed.js";

type StepStatus = "pending" | "running" | "complete" | "failed";

type StepState<T> = { status: StepStatus; summary: T | null; error: string | null };

export type FeedPullRun = {
  brandId: string;
  status: "running" | "complete" | "failed";
  startedAt: string;
  finishedAt: string | null;
  currentStep: "ads" | "organic" | "rank" | null;
  steps: {
    ads: StepState<BrandAdIngestSummary>;
    organic: StepState<BrandOrganicIngestSummary>;
    rank: StepState<FeedRankSummary>;
  };
  error: string | null;
};

const runs = new Map<string, FeedPullRun>();

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A hard precondition (missing prompt / no products) — abort the whole run. */
function isPrecondition(err: unknown): boolean {
  return err instanceof PromptNotConfiguredError || /no products/i.test(msg(err));
}

function freshStep<T>(): StepState<T> {
  return { status: "pending", summary: null, error: null };
}

/** Current run snapshot for a brand (null if none has ever run this process). */
export function getFeedPullRun(brandId: string): FeedPullRun | null {
  return runs.get(brandId) ?? null;
}

/**
 * Start a pull for a brand. Idempotent while one is in flight: returns the
 * live run with `alreadyRunning=true` instead of launching a second. The actual
 * work runs in the background; poll `getFeedPullRun`.
 */
export function startFeedPull(brandId: string): { run: FeedPullRun; alreadyRunning: boolean } {
  const existing = runs.get(brandId);
  if (existing && existing.status === "running") return { run: existing, alreadyRunning: true };

  const run: FeedPullRun = {
    brandId,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    currentStep: null,
    steps: {
      ads: freshStep<BrandAdIngestSummary>(),
      organic: freshStep<BrandOrganicIngestSummary>(),
      rank: freshStep<FeedRankSummary>(),
    },
    error: null,
  };
  runs.set(brandId, run);
  void runFeedPull(run).catch((err) => {
    // Defensive: runFeedPull handles its own errors, but never let a rejection escape.
    run.status = "failed";
    run.error = msg(err);
    run.currentStep = null;
    run.finishedAt = new Date().toISOString();
  });
  return { run, alreadyRunning: false };
}

async function runFeedPull(run: FeedPullRun): Promise<void> {
  const { brandId } = run;
  try {
    // ── 1. Ads ──
    run.currentStep = "ads";
    run.steps.ads.status = "running";
    try {
      run.steps.ads.summary = await ingestBrandAds(brandId, "all");
      run.steps.ads.status = "complete";
    } catch (err) {
      run.steps.ads.status = "failed";
      run.steps.ads.error = msg(err);
      // Missing prompt / no products dooms organic + rank too — fail fast.
      if (isPrecondition(err)) {
        run.status = "failed";
        run.error = msg(err);
        return;
      }
      console.error(`[ad-console] pull: ads step failed for ${brandId}:`, err);
    }

    // ── 2. Organic ──
    run.currentStep = "organic";
    run.steps.organic.status = "running";
    try {
      run.steps.organic.summary = await ingestBrandOrganic(brandId, "all");
      run.steps.organic.status = "complete";
    } catch (err) {
      run.steps.organic.status = "failed";
      run.steps.organic.error = msg(err);
      console.error(`[ad-console] pull: organic step failed for ${brandId}:`, err);
    }

    // ── 3. Rank ── (always — re-ranks whatever made it into the pools)
    run.currentStep = "rank";
    run.steps.rank.status = "running";
    try {
      run.steps.rank.summary = await rankBrandFeed(brandId);
      run.steps.rank.status = "complete";
    } catch (err) {
      run.steps.rank.status = "failed";
      run.steps.rank.error = msg(err);
      console.error(`[ad-console] pull: rank step failed for ${brandId}:`, err);
    }

    // Run is "complete" if at least the ranking succeeded; otherwise failed.
    run.status = run.steps.rank.status === "complete" ? "complete" : "failed";
    if (run.status === "failed" && !run.error) {
      run.error = run.steps.rank.error ?? "Feed pull finished with errors.";
    }
  } finally {
    run.currentStep = null;
    run.finishedAt = new Date().toISOString();
    console.log(`[ad-console] pull finished for ${brandId}: ${run.status}`);
  }
}
