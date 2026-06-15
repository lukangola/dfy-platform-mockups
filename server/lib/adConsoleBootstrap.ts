/**
 * Ad Console — background "make the brand ready" orchestration.
 *
 * The Console used to require the operator to click "Detect niche" and
 * "Discover competitors" by hand. Those are pure LLM calls (no Apify spend),
 * so we now run them — plus angle-keyword extraction — automatically in the
 * background the first time a brand opens the Console.
 *
 * Three idempotent steps, each guarded independently so one failure never
 * blocks the others:
 *   1. ensureBrandNiche       — classify the brand (Haiku) if not already set.
 *   2. discoverCompetitors    — LLM web_search (Opus), ONLY when the watchlist
 *                               is empty, so we never duplicate-add on reload.
 *   3. ensureBrandKeywords    — extract per-angle keyword sets (Opus), bounded
 *                               + idempotent (skips angles already complete).
 *
 * CREDIT SAFETY: none of these touch Apify. They are LLM-only, which the
 * project rules permit on auto/background paths. Apify pulls still fire only
 * from the explicit manual "Pull this week's feed" button.
 *
 * Concurrency: an in-flight Map dedupes overlapping calls for the same brand
 * (e.g. the page firing the route twice), so the expensive work runs once.
 */
import { ensureBrandNiche } from "./adConsoleNiche.js";
import { discoverCompetitors, listCompetitors } from "./adConsoleCompetitors.js";
import { ensureBrandKeywords } from "./adConsoleKeywords.js";
import { PromptNotConfiguredError } from "./prompts.js";

type StepStatus = "ok" | "skipped" | "failed";

export type ConsoleBootstrapResult = {
  brandId: string;
  niche: string | null;
  seeded: boolean;
  competitorCount: number;
  competitorsDiscovered: number;
  keywords: { totalAngles: number; extracted: number; failed: number } | null;
  steps: { niche: StepStatus; competitors: StepStatus; keywords: StepStatus };
  /** Human-readable, per-step failures — surfaced for logging, not fatal. */
  errors: string[];
};

const inFlight = new Map<string, Promise<ConsoleBootstrapResult>>();

function describe(err: unknown): string {
  if (err instanceof PromptNotConfiguredError) return `prompt not configured: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

async function runBootstrap(brandId: string): Promise<ConsoleBootstrapResult> {
  const result: ConsoleBootstrapResult = {
    brandId,
    niche: null,
    seeded: false,
    competitorCount: 0,
    competitorsDiscovered: 0,
    keywords: null,
    steps: { niche: "skipped", competitors: "skipped", keywords: "skipped" },
    errors: [],
  };

  // ── 1. Niche ──────────────────────────────────────────────────────────────
  try {
    const state = await ensureBrandNiche(brandId);
    result.niche = state.nicheType;
    result.seeded = state.seeded;
    result.steps.niche = "ok";
  } catch (err) {
    result.steps.niche = "failed";
    result.errors.push(`niche: ${describe(err)}`);
    console.error(`[ad-console] bootstrap niche failed for ${brandId}:`, err);
  }

  // ── 2. Competitors — discover only when the watchlist is empty ─────────────
  try {
    const existing = await listCompetitors(brandId);
    if (existing.length > 0) {
      result.competitorCount = existing.length;
      result.steps.competitors = "skipped";
    } else {
      const { all, discovered } = await discoverCompetitors(brandId);
      result.competitorCount = all.length;
      result.competitorsDiscovered = discovered;
      result.steps.competitors = "ok";
    }
  } catch (err) {
    result.steps.competitors = "failed";
    result.errors.push(`competitors: ${describe(err)}`);
    console.error(`[ad-console] bootstrap competitor discovery failed for ${brandId}:`, err);
  }

  // ── 3. Angle keywords ──────────────────────────────────────────────────────
  try {
    const k = await ensureBrandKeywords(brandId);
    result.keywords = { totalAngles: k.totalAngles, extracted: k.extracted, failed: k.failed };
    result.steps.keywords = "ok";
  } catch (err) {
    result.steps.keywords = "failed";
    result.errors.push(`keywords: ${describe(err)}`);
    console.error(`[ad-console] bootstrap keyword extraction failed for ${brandId}:`, err);
  }

  return result;
}

/**
 * Run (or join the in-flight run of) the brand's Console bootstrap. Safe to
 * call on every Console load — each step no-ops when its work is already done.
 */
export function ensureBrandConsoleReady(brandId: string): Promise<ConsoleBootstrapResult> {
  const pending = inFlight.get(brandId);
  if (pending) return pending;

  const run = runBootstrap(brandId).finally(() => {
    inFlight.delete(brandId);
  });
  inFlight.set(brandId, run);
  return run;
}
