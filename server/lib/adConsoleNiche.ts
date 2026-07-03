/**
 * Ad Creative Console — brand niche detection + niche-stream provisioning.
 *
 * Two responsibilities (Phase 0 of the Ad Creative Console):
 *
 *   1. `ensureNicheStream(niche)` — lazily materialize the shared
 *      `niche_streams` row for a niche from its seed config (nicheConfig.ts).
 *      Idempotent via ON CONFLICT DO NOTHING on the unique `niche` index, so an
 *      operator's later hand-tuning of the live row is never overwritten.
 *
 *   2. `detectBrandNiche(brandId)` — classify a brand as supplement / skincare
 *      / other from its product catalog + research markdown (a cheap Haiku
 *      call), persist the result to `brands.nicheType`, and attach the matching
 *      niche stream. Best-effort: failures are logged and surfaced to the
 *      caller, never thrown into the request path on boot paths.
 *
 *   3. `getBrandNicheState(brandId)` — read helper the Console uses to decide
 *      whether to show the feed (seeded niche + stream) or prompt the operator
 *      to (re)detect.
 */
import { eq } from "drizzle-orm";
import { generateText } from "./anthropic.js";
import { db, schema } from "./db.js";
import { extractJsonObject } from "./jsonExtract.js";
import { loadPrompt, PromptNotConfiguredError } from "./prompts.js";
import { AD_CONSOLE_NICHES, DEFAULT_NICHE_CONFIG, getNicheSeed } from "./nicheConfig.js";
import type { NicheStream } from "../db/schema.js";

const CLASSIFY_ACTION = "brand_niche_classify";

// Cap how much research markdown we feed the classifier per product — the niche
// is obvious from the first paragraph, and we don't want a 20KB diagnosis
// blowing the cheap Haiku budget across a multi-product brand.
const RESEARCH_EXCERPT_CHARS = 1200;
const MAX_PRODUCTS_IN_CONTEXT = 6;

export type NicheClassification = {
  niche: string; // one of AD_CONSOLE_NICHES, or "other"
  confidence: number;
  reasoning: string;
  /** True when `niche` is a configured/seeded stream (vs "other" / unsupported). */
  seeded: boolean;
};

export type BrandNicheState = {
  nicheType: string | null;
  seeded: boolean;
  stream: NicheStream | null;
};

/**
 * Materialize (or fetch) the shared niche_streams row for a niche from its seed
 * config. Returns null if the niche has no seed config (e.g. "other"). Safe to
 * call concurrently and repeatedly — the insert is guarded by ON CONFLICT DO
 * NOTHING on the unique niche index, so a hand-tuned live row is preserved.
 */
export async function ensureNicheStream(niche: string): Promise<NicheStream | null> {
  const seed = getNicheSeed(niche);
  if (!seed) return null;

  const [existing] = await db
    .select()
    .from(schema.nicheStreams)
    .where(eq(schema.nicheStreams.niche, niche))
    .limit(1);
  if (existing) return existing;

  await db
    .insert(schema.nicheStreams)
    .values({
      niche: seed.niche,
      displayName: seed.displayName,
      keywords: seed.keywords,
      leadingAdvertisers: seed.leadingAdvertisers,
      painPointKeywords: seed.painPointKeywords,
      config: seed.config,
    })
    .onConflictDoNothing({ target: schema.nicheStreams.niche });

  const [row] = await db
    .select()
    .from(schema.nicheStreams)
    .where(eq(schema.nicheStreams.niche, niche))
    .limit(1);
  return row ?? null;
}

/** Read the brand's current niche state for the Console. */
export async function getBrandNicheState(brandId: string): Promise<BrandNicheState> {
  const [brand] = await db
    .select({ nicheType: schema.brands.nicheType })
    .from(schema.brands)
    .where(eq(schema.brands.id, brandId))
    .limit(1);
  const nicheType = brand?.nicheType ?? null;
  if (!nicheType) return { nicheType: null, seeded: false, stream: null };
  const seeded = AD_CONSOLE_NICHES.includes(nicheType);
  // Seeded niches share a curated stream; every other brand gets a per-brand
  // stream so organic + the niche ad-lane still pull — driven by the brand's own
  // keywords. `seeded` stays false (it's not a curated seed), but a stream exists.
  const stream = seeded ? await ensureNicheStream(nicheType) : await ensureBrandNicheStream(brandId, nicheType);
  return { nicheType, seeded, stream };
}

/**
 * Per-brand fallback niche stream for UNSEEDED niches (e.g. "other" / any niche
 * without a curated seed). Organic and the niche ad-lane are driven entirely by
 * the brand's OWN angle keywords (buildBrandSearchQueries), so the stream only
 * needs to exist as a brand-scoped id to tag + rank the pulled posts/ads. Keyed
 * per brand so one brand's organic never bleeds into another's. Empty seed
 * keyword lists are intentional — the brand's keywords supply the search terms.
 */
export async function ensureBrandNicheStream(brandId: string, nicheType: string): Promise<NicheStream | null> {
  const key = `brand:${brandId}`;
  const [existing] = await db
    .select()
    .from(schema.nicheStreams)
    .where(eq(schema.nicheStreams.niche, key))
    .limit(1);
  if (existing) return existing;
  await db
    .insert(schema.nicheStreams)
    .values({
      niche: key,
      displayName: nicheType || "Custom",
      keywords: { adLibrary: [], organic: [], hashtags: [] },
      leadingAdvertisers: [],
      painPointKeywords: [],
      config: DEFAULT_NICHE_CONFIG,
    })
    .onConflictDoNothing({ target: schema.nicheStreams.niche });
  const [row] = await db
    .select()
    .from(schema.nicheStreams)
    .where(eq(schema.nicheStreams.niche, key))
    .limit(1);
  return row ?? null;
}

/**
 * Build the classifier's user-message context from the brand + its products.
 * Returns null if there's nothing useful to classify on (no products / no
 * research), so the caller can surface a clear "research first" error.
 */
function buildBrandContext(
  brandName: string,
  products: { name: string; category: string | null; research: unknown }[],
): string | null {
  if (products.length === 0) return null;

  const lines: string[] = [`BRAND NAME: ${brandName}`, "", "PRODUCTS:"];
  let sawResearch = false;
  for (const p of products.slice(0, MAX_PRODUCTS_IN_CONTEXT)) {
    lines.push(`- ${p.name}${p.category ? ` (category: ${p.category})` : ""}`);
    const research = (p.research ?? {}) as { markdown?: unknown };
    const markdown = typeof research.markdown === "string" ? research.markdown.trim() : "";
    if (markdown) {
      sawResearch = true;
      const excerpt = markdown.slice(0, RESEARCH_EXCERPT_CHARS);
      lines.push(`  Research excerpt: ${excerpt}${markdown.length > RESEARCH_EXCERPT_CHARS ? "…" : ""}`);
    }
  }

  // Product names + categories alone are enough signal even without research,
  // so we only bail when there are literally no products.
  void sawResearch;
  return lines.join("\n");
}

/**
 * Classify a brand's niche and persist it to brands.nicheType, attaching the
 * matching shared niche stream. Returns the classification. Throws only on
 * hard failures (no products to classify, prompt missing) — the caller decides
 * how to surface those.
 */
export async function detectBrandNiche(brandId: string): Promise<NicheClassification> {
  const [brand] = await db
    .select({ id: schema.brands.id, name: schema.brands.name })
    .from(schema.brands)
    .where(eq(schema.brands.id, brandId))
    .limit(1);
  if (!brand) throw new Error("Brand not found");

  const products = await db
    .select({
      name: schema.products.name,
      category: schema.products.category,
      research: schema.products.research,
    })
    .from(schema.products)
    .where(eq(schema.products.brandId, brandId));

  const context = buildBrandContext(brand.name, products);
  if (!context) {
    throw new Error("Brand has no products to classify — add a product first.");
  }

  const prompt = loadPrompt(CLASSIFY_ACTION);
  const result = await generateText({
    systemPrompt: prompt.rendered,
    userMessage: `${context}\n\nClassify this brand's niche. Output only the JSON object specified.`,
    model: prompt.config.model ?? "claude-haiku-4-5",
    maxTokens: prompt.config.maxTokens ?? 250,
  });

  let parsed: { niche?: unknown; confidence?: unknown; reasoning?: unknown } = {};
  try {
    parsed = extractJsonObject(result.text, {
      stopReason: result.stopReason,
      action: "Brand niche classifier",
    });
  } catch {
    // Best-effort — leave parsed empty so we fall through to "other".
  }

  const rawNiche = typeof parsed.niche === "string" ? parsed.niche.trim().toLowerCase() : "";
  const seeded = AD_CONSOLE_NICHES.includes(rawNiche);
  const niche = seeded ? rawNiche : "other";
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";

  // Persist the literal result (including "other") so we don't reclassify on
  // every Console open; only seeded niches get a stream attached.
  await db
    .update(schema.brands)
    .set({ nicheType: niche })
    .where(eq(schema.brands.id, brandId));

  if (seeded) {
    try {
      await ensureNicheStream(niche);
    } catch (err) {
      console.error(`[ad-console] ensureNicheStream(${niche}) failed for brand ${brandId}:`, err);
    }
  }

  await db.insert(schema.generations).values({
    action: CLASSIFY_ACTION,
    kind: "text",
    inputs: { brandId, brandName: brand.name, productCount: products.length },
    output: { niche, confidence, reasoning },
    model: result.model,
    promptVersion: prompt.version,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: String(result.costUsd),
    durationMs: result.durationMs,
  });

  console.log(`[ad-console] classified brand ${brandId} → ${niche} (conf=${confidence}, ${result.durationMs}ms)`);
  return { niche, confidence, reasoning, seeded };
}

/**
 * Lazily ensure a brand has a niche assigned. If brands.nicheType is already
 * set, returns its state unchanged. Otherwise runs detection. Used by the
 * Console / feed-pull paths so a brand auto-classifies on first use without the
 * operator clicking anything. PromptNotConfiguredError is re-thrown so callers
 * can surface a 424.
 */
export async function ensureBrandNiche(brandId: string): Promise<BrandNicheState> {
  const current = await getBrandNicheState(brandId);
  if (current.nicheType) return current;
  try {
    await detectBrandNiche(brandId);
  } catch (err) {
    if (err instanceof PromptNotConfiguredError) throw err;
    console.error(`[ad-console] ensureBrandNiche detection failed for ${brandId}:`, err);
    throw err;
  }
  return getBrandNicheState(brandId);
}
